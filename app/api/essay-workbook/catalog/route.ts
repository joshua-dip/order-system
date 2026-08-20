import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 서술형 워크북 — 판매 가능한 교재 목록 (비로그인도 조회) */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { isPlaceholder: { $ne: true }, textbook: { $nin: ['', null] } } },
        { $group: { _id: { textbook: '$textbook', sourceKey: '$sourceKey' } } },
        { $group: { _id: '$_id.textbook', sourceCount: { $sum: 1 } } },
        { $match: { sourceCount: { $gt: 0 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return NextResponse.json({
      ok: true,
      textbooks: rows.map((r) => ({ textbook: String(r._id), sourceCount: r.sourceCount as number })),
    });
  } catch (e) {
    console.error('[essay-workbook catalog]', e);
    return NextResponse.json({ ok: true, textbooks: [] });
  }
}
