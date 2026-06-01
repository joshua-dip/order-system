import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getGrammarWorkbook, GRAMMAR_MODES, type GrammarMode } from '@/lib/grammar-workbooks-store';
import { buildBulkWorkbookHtml } from '@/lib/grammar-workbook-print';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 선택된 여러 워크북을 한 HTML 합본으로 묶어 반환.
 * Client 는 새 창에서 print() — 브라우저 다이얼로그에서 「PDF로 저장」 시 1개 파일.
 *
 * body: {
 *   ids: string[],
 *   modes?: ('F'|'G'|'H'|'J'|'P')[],
 *   includePoints?: boolean,
 *   layout?: 'interleaved'|'back',
 *   title?: string  // 출력 창 title (파일명에 영향)
 * }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    ids?: unknown;
    modes?: unknown;
    includePoints?: unknown;
    layout?: unknown;
    title?: unknown;
  };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds
    .filter((v): v is string => typeof v === 'string' && ObjectId.isValid(v))
    .slice(0, 200);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 가 비어있습니다.' }, { status: 400 });
  }

  const modesArr = Array.isArray(body.modes)
    ? (body.modes
        .filter((v): v is string => typeof v === 'string')
        .filter((m) => m === 'P' || (GRAMMAR_MODES as string[]).includes(m)) as (GrammarMode | 'P')[])
    : undefined;
  const includePoints = body.includePoints !== false;
  const layout = body.layout === 'back' ? 'back' : 'interleaved';
  const shellTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '';

  const docs = (
    await Promise.all(ids.map((id) => getGrammarWorkbook(id)))
  ).filter((d): d is NonNullable<typeof d> => d != null);

  if (docs.length === 0) {
    return NextResponse.json({ error: '유효한 워크북을 찾지 못했습니다.' }, { status: 404 });
  }

  const built = buildBulkWorkbookHtml(docs, {
    modes: modesArr,
    includePoints,
    layout,
    title: shellTitle || `어법공략 ${docs.length}건 합본`,
  });
  if (!built) {
    return NextResponse.json({ error: '출력할 모드가 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    count: docs.length,
    layout,
    html: built.html,
    perWorkbook: built.perWorkbook,
  });
}
