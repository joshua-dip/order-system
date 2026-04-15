import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { MEMBER_GENERATED_QUESTIONS_COLLECTION } from '@/lib/member-variant-storage';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  buildMemberVariantDocxBuffer,
  buildMemberVariantPdfBuffer,
  buildMemberVariantXlsxBuffer,
} from '@/lib/member-variant-export-build';
import { buildMemberVariantHwpxBuffer } from '@/lib/member-variant-hwpx-build';

const MAX_IDS = 100;

type ExportFormat = 'xlsx' | 'pdf' | 'docx' | 'hwpx';

function parseFormat(v: unknown): ExportFormat | null {
  if (v === 'xlsx' || v === 'pdf' || v === 'docx' || v === 'hwpx') return v;
  return null;
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

    if (format === 'xlsx') {
      const buf = await buildMemberVariantXlsxBuffer(found);
      const nameKo = `회원변형문항_${stamp}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="member-variant-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(nameKo)}`,
        },
      });
    }

    if (format === 'pdf') {
      const buf = await buildMemberVariantPdfBuffer(found);
      const nameKo = `회원변형문항_${stamp}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="member-variant-${stamp}.pdf"; filename*=UTF-8''${encodeURIComponent(nameKo)}`,
        },
      });
    }

    if (format === 'hwpx') {
      const buf = await buildMemberVariantHwpxBuffer(found);
      const nameKo = `회원변형문항_${stamp}.hwpx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/x-hwpx',
          'Content-Disposition': `attachment; filename="member-variant-${stamp}.hwpx"; filename*=UTF-8''${encodeURIComponent(nameKo)}`,
        },
      });
    }

    const buf = await buildMemberVariantDocxBuffer(found);
    const nameKo = `회원변형문항_${stamp}.docx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="member-variant-${stamp}.docx"; filename*=UTF-8''${encodeURIComponent(nameKo)}`,
      },
    });
  } catch (e) {
    console.error('member-variant export:', e);
    return NextResponse.json({ error: '파일을 만들지 못했습니다.' }, { status: 500 });
  }
}
