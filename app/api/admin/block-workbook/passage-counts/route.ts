import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET ?textbook=xxx
 * 해당 교재에서 저장된 블록 빈칸 워크북 수를 sourceKey 별로 반환.
 * Response: { counts: Record<sourceKey, number> }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) return NextResponse.json({ counts: {} });

  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('block_workbooks')
      .aggregate([
        { $match: { textbook } },
        { $group: { _id: '$sourceKey', count: { $sum: 1 } } },
      ])
      .toArray();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row._id) counts[String(row._id)] = Number(row.count);
    }
    return NextResponse.json({ counts });
  } catch (e) {
    console.error('[block-workbook/passage-counts]', e);
    return NextResponse.json({ counts: {} });
  }
}
