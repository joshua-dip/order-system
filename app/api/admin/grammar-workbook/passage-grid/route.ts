import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageGrid } from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

/**
 * GET ?textbook=NAME
 * 한 교재의 지문 그리드 — 각 지문 (강·번호·source_key) + F/G/H/J 모드 완료 여부.
 * 현황 모달 drill-down 용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 이 필요합니다.' }, { status: 400 });
  }

  try {
    const passages = await getPassageGrid(textbook);
    return NextResponse.json({ ok: true, textbook, passages });
  } catch (e) {
    console.error('[grammar-workbook/passage-grid]', e);
    return NextResponse.json({ error: 'passage-grid 조회 실패' }, { status: 500 });
  }
}
