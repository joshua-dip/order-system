import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';

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

    // 모의고사 서술형 워크북은 payperic.com 에서 판매한다. 여기서는 부교재만 노출.
    const all = rows.map((r) => ({ textbook: String(r._id), sourceCount: r.sourceCount as number }));
    const textbooks = all.filter((t) => !isMockExamTextbookKey(t.textbook));

    return NextResponse.json({
      ok: true,
      textbooks,
      mockExamCount: all.length - textbooks.length,
    });
  } catch (e) {
    console.error('[essay-workbook catalog]', e);
    return NextResponse.json({ ok: true, textbooks: [] });
  }
}
