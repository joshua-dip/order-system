import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'node:fs';
import JSZip from 'jszip';
import { collectZipEntries } from '@/lib/shared-resources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 공유자료 ZIP 묶음 다운로드.
 *
 * Query params:
 *   exam      : 회차 슬러그 (필수)
 *   category  : 카테고리명 (선택)
 *   sub       : 서브 카테고리 (선택, category 와 함께)
 *   number    : 번호 키 (선택, ex: "18", "41~42", "all"). 여러 번 지정 시 선택 묶음 ZIP.
 *               또는 `numbers=18,19,20` 콤마 구분도 지원.
 *
 * 적용 우선순위 (구체적 → 일반):
 *   - exam + category + sub + number(s) → 선택 번호들 묶음
 *   - exam + category + sub             → 서브 카테고리 전체
 *   - exam + category + number(s)       → 카테고리 안 선택 번호들
 *   - exam + category                   → 카테고리 전체
 *   - exam                              → 회차 전체
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const exam = searchParams.get('exam')?.trim().normalize('NFC');
  const category = searchParams.get('category')?.trim().normalize('NFC') || undefined;
  const sub = searchParams.get('sub')?.trim().normalize('NFC') || undefined;

  /* number 는 여러 번 등장하거나 `numbers=18,19` 콤마 구분 가능. NFC 정규화 + 빈 값 제거. */
  const rawNumbers = [
    ...searchParams.getAll('number'),
    ...(searchParams.get('numbers')?.split(',') ?? []),
  ];
  const numberKeys = Array.from(
    new Set(rawNumbers.map((n) => n.trim().normalize('NFC')).filter(Boolean))
  );

  if (!exam) {
    return jsonError(400, 'exam param required');
  }

  /* 슬러그·이름 안전성 — 슬래시·`..` 차단. URL 인코딩된 값은 NextRequest 가 이미 디코딩한 상태 */
  if (containsTraversal(exam) || (category && containsTraversal(category)) || (sub && containsTraversal(sub))) {
    return jsonError(400, 'Invalid path');
  }
  if (numberKeys.some((n) => containsTraversal(n))) {
    return jsonError(400, 'Invalid path');
  }

  const plan = collectZipEntries({
    examSlug: exam,
    category,
    subCategory: sub,
    numberKeys: numberKeys.length > 0 ? numberKeys : undefined,
  });

  if (!plan || plan.entries.length === 0) {
    return jsonError(404, 'Not found');
  }

  const zip = new JSZip();
  /* 비동기 + 병렬로 디스크 읽기. 깨진 파일은 스킵. */
  await Promise.all(
    plan.entries.map(async (e) => {
      try {
        const buf = await fsp.readFile(e.abs);
        zip.file(e.name, buf);
      } catch {
        /* 깨진 파일은 스킵 */
      }
    }),
  );

  /* 스트림 응답 — 큰 회차(40MB+) 도 메모리 점유 없이 흘려보낸다.
     JSZip Node 스트림을 Web ReadableStream 으로 직접 어댑트. */
  const nodeStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      /* JSZip StreamHelper 는 pause 만 지원. 클라이언트가 끊으면 흘리기만 멈춤. */
      nodeStream.pause();
    },
  });

  /* RFC 5987 — 한글 파일명은 UTF-8 인코딩, 호환 fallback 은 examSlug 기반 영문. */
  const encoded = encodeURIComponent(plan.zipName);
  const fallback = asciiFallback(plan.zipName, exam);

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'public, max-age=600, s-maxage=600',
    },
  });
}

function jsonError(status: number, message: string) {
  return new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function containsTraversal(s: string): boolean {
  if (s.includes('..')) return true;
  if (s.includes('/') || s.includes('\\')) return true;
  return false;
}

/**
 * RFC 6266 의 ASCII fallback. 한글 등 비-ASCII 는 `_` 로 대체.
 * 전부 날아가서 공허해지면 examSlug(영문) 기반 이름으로 폴백 → 최소한 의미 보존.
 */
function asciiFallback(name: string, examSlug: string): string {
  const stripped = name.replace(/[^\x20-\x7E]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const meaningful = stripped.replace(/\.zip$/i, '').replace(/[_\s-]/g, '');
  if (meaningful.length > 0) return stripped.endsWith('.zip') ? stripped : `${stripped}.zip`;
  return `${examSlug}.zip`;
}
