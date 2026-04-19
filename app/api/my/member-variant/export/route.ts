import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { MEMBER_GENERATED_QUESTIONS_COLLECTION } from '@/lib/member-variant-storage';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IDS = 100;

type ExportFormat = 'xlsx' | 'pdf' | 'docx' | 'hwpx';
type ExportMode = 'student' | 'teacher';

function parseMode(v: unknown): ExportMode {
  return v === 'student' ? 'student' : 'teacher';
}

function parseFormat(v: unknown): ExportFormat | null {
  if (v === 'xlsx' || v === 'pdf' || v === 'docx' || v === 'hwpx') return v;
  return null;
}

/**
 * Buffer → ArrayBuffer 변환 후 Content-Length 명시한 응답.
 * Amplify SSR Lambda의 바이너리 직렬화 안정화를 위해 Content-Length 필수.
 */
function binaryResponse(
  buf: Buffer,
  contentType: string,
  filenameAscii: string,
  filenameUtf8: string,
): NextResponse {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new NextResponse(ab as ArrayBuffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.byteLength),
      'Content-Disposition': `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const format = parseFormat((body as { format?: unknown })?.format);
  const mode = parseMode((body as { mode?: unknown })?.mode);
  const rawIds = (body as { ids?: unknown })?.ids;
  if (!format) {
    return NextResponse.json({ error: 'format은 xlsx, pdf, docx, hwpx 중 하나여야 합니다.' }, { status: 400 });
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: 'ids 배열이 필요합니다.' }, { status: 400 });
  }
  if (rawIds.length > MAX_IDS) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_IDS}개까지 보낼 수 있습니다.` }, { status: 400 });
  }

  const ids = rawIds.map((x) => String(x)).filter((id) => ObjectId.isValid(id));
  if (ids.length === 0) {
    return NextResponse.json({ error: '유효한 문항 id가 없습니다.' }, { status: 400 });
  }

  const oids = ids.map((id) => new ObjectId(id));
  const order = new Map(ids.map((id, i) => [id, i]));

  try {
    const db = await getDb('gomijoshua');
    const found = await db
      .collection(MEMBER_GENERATED_QUESTIONS_COLLECTION)
      .find({ _id: { $in: oids }, ownerUserId: auth.userId })
      .project({
        type: 1,
        difficulty: 1,
        textbook: 1,
        source: 1,
        status: 1,
        created_at: 1,
        question_data: 1,
      })
      .toArray();

    if (found.length === 0) {
      return NextResponse.json({ error: '보낼 문항을 찾을 수 없습니다.' }, { status: 404 });
    }

    found.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const modeSuffix = mode === 'student' ? '_학생용' : '_교사용';

    // 포맷별 dynamic import: 특정 라이브러리(pdfkit·kordoc)가 Lambda에서
    // 못 찾히더라도 해당 포맷만 실패하고 나머지는 정상 동작하도록 격리.
    if (format === 'xlsx') {
      const { buildMemberVariantXlsxBuffer } = await import('@/lib/member-variant-export-build');
      const buf = await buildMemberVariantXlsxBuffer(found);
      return binaryResponse(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `member-variant-${stamp}.xlsx`,
        `회원변형문항${modeSuffix}_${stamp}.xlsx`,
      );
    }

    if (format === 'pdf') {
      const { buildMemberVariantPdfBuffer } = await import('@/lib/member-variant-export-build');
      const buf = await buildMemberVariantPdfBuffer(found, mode);
      return binaryResponse(
        buf,
        'application/pdf',
        `member-variant-${stamp}.pdf`,
        `회원변형문항${modeSuffix}_${stamp}.pdf`,
      );
    }

    if (format === 'hwpx') {
      const { buildMemberVariantHwpxBuffer } = await import('@/lib/member-variant-hwpx-build');
      const buf = await buildMemberVariantHwpxBuffer(found, mode);
      return binaryResponse(
        buf,
        'application/x-hwpx',
        `member-variant-${stamp}.hwpx`,
        `회원변형문항${modeSuffix}_${stamp}.hwpx`,
      );
    }

    // docx
    const { buildMemberVariantDocxBuffer } = await import('@/lib/member-variant-export-build');
    const buf = await buildMemberVariantDocxBuffer(found, mode);
    return binaryResponse(
      buf,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      `member-variant-${stamp}.docx`,
      `회원변형문항${modeSuffix}_${stamp}.docx`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? (e.stack ?? '') : '';
    console.error('member-variant export:', msg, stack);
    return NextResponse.json(
      { error: '파일을 만들지 못했습니다.', detail: msg },
      { status: 500 },
    );
  }
}
