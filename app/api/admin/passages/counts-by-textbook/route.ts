import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/** 교재별 지문 수 집계: { counts: { "교재명": 280, ... } } */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('passages')
      .aggregate([
        { $group: { _id: '$textbook', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (typeof r._id === 'string' && r._id) {
        counts[r._id] = typeof r.count === 'number' ? r.count : 0;
      }
    }
    return NextResponse.json({ counts });
  } catch (e) {
    console.error('passages counts-by-textbook GET:', e);
    return NextResponse.json({ error: '집계 실패' }, { status: 500 });
  }
}
