import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageCountsByTextbook } from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

/**
 * GET ?textbook=xxx
 * sourceKey 별 { total, modes: { F, G, H, J } } 반환.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) return NextResponse.json({ counts: {} });

  try {
    const counts = await getPassageCountsByTextbook(textbook);
    return NextResponse.json({ counts });
  } catch (e) {
    console.error('[grammar-workbook/passage-counts]', e);
    return NextResponse.json({ counts: {} });
  }
}
