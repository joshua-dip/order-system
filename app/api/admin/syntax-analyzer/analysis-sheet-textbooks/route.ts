import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 분석 데이터가 있는 교재만 — 지문 분석지의 교재 드롭다운용.
 *
 * 전체 교재 목록(/api/admin/passages/textbooks)은 300개가 넘는데 분석이 채워진
 * 교재는 몇 안 된다. 다 보여주면 빈 교재를 골라 "0개 분석 있음"만 만나게 되므로,
 * passage_analyses 에서 실제 채워진 지문을 역추적해 교재별 개수와 함께 준다.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    /* sentences 가 비어 있으면 지면에 낼 것이 없다 — 문서만 있는 껍데기는 제외. */
    const analyses = await db
      .collection('passage_analyses')
      .find({ 'passageStates.main.sentences.0': { $exists: true } })
      .project({ fileName: 1 })
      .toArray();

    const ids: ObjectId[] = [];
    for (const d of analyses) {
      const m = /^passage:([a-f0-9]{24})$/i.exec(String((d as { fileName?: string }).fileName ?? ''));
      if (m) ids.push(new ObjectId(m[1]));
    }
    if (ids.length === 0) {
      return NextResponse.json({ textbooks: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const grouped = await db
      .collection('passages')
      .aggregate([
        { $match: { _id: { $in: ids } } },
        { $group: { _id: '$textbook', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const textbooks = grouped
      .filter((g) => typeof g._id === 'string' && g._id.trim())
      .map((g) => ({ name: String(g._id), count: Number(g.count) || 0 }));
    return NextResponse.json({ textbooks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('analysis-sheet-textbooks:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.', textbooks: [] }, { status: 500 });
  }
}
