import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getTextbookCoverage } from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

/**
 * GET — 교재별 현황. 서술형 출제기 「현황」 패널과 동일 패턴.
 * Response: { items: TextbookCoverage[] }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const items = await getTextbookCoverage({ limit: 300 });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error('[grammar-workbook/coverage]', e);
    return NextResponse.json({ error: '현황 조회 실패' }, { status: 500 });
  }
}
