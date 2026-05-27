import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isMockExamTextbookKey, mockExamGradeOf } from '@/lib/mock-exam-key';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qna/passages
 *
 * 모의고사 교재 목록 + 회차별 지문 수.
 * - `passages.textbook` distinct → `isMockExamTextbookKey` 통과한 것만.
 * - 학년 분류는 `mockExamGradeOf` 로 (고1/고2/고3 만 카운트. 수능 등은 grade=null).
 *
 * 응답: `{ textbooks: [{ key, grade, count }] }` — grade desc/asc 그대로, 정렬은 클라이언트가.
 */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');

    // 1) distinct textbook
    const allTextbooks = (await db.collection('passages').distinct('textbook')) as string[];
    const mockKeys = allTextbooks.filter((k) => typeof k === 'string' && isMockExamTextbookKey(k));

    if (mockKeys.length === 0) {
      return NextResponse.json({ textbooks: [] as Array<{ key: string; grade: string | null; count: number }> });
    }

    // 2) 회차별 지문 수 (한 번에 group)
    const agg = await db
      .collection('passages')
      .aggregate<{ _id: string; count: number }>([
        { $match: { textbook: { $in: mockKeys } } },
        { $group: { _id: '$textbook', count: { $sum: 1 } } },
      ])
      .toArray();

    const countByKey = new Map<string, number>();
    for (const r of agg) countByKey.set(r._id, r.count);

    const textbooks = mockKeys.map((key) => ({
      key,
      grade: mockExamGradeOf(key),
      count: countByKey.get(key) ?? 0,
    }));

    return NextResponse.json({ textbooks });
  } catch (e) {
    console.error('qna passages GET:', e);
    return NextResponse.json({ error: '교재 목록 조회에 실패했습니다.' }, { status: 500 });
  }
}
