import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * 교재 × 유형 × 상태 집계.
 * 응답: { textbooks: string[], types: string[], rows: StatsRow[] }
 * StatsRow: { textbook, type, total, 완료, 대기, 검수불일치 }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');

    const pipeline = [
      {
        $group: {
          _id: { textbook: '$textbook', type: '$type', status: '$status' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: { textbook: '$_id.textbook', type: '$_id.type' },
          total: { $sum: '$count' },
          byStatus: { $push: { status: '$_id.status', count: '$count' } },
        },
      },
      { $sort: { '_id.textbook': 1, '_id.type': 1 } },
    ];

    const rows = await db.collection('generated_questions').aggregate(pipeline).toArray();

    const textbookSet = new Set<string>();
    const typeSet = new Set<string>();
    const data: {
      textbook: string;
      type: string;
      total: number;
      완료: number;
      대기: number;
      검수불일치: number;
      기타: number;
    }[] = [];

    for (const row of rows) {
      const textbook = String(row._id?.textbook ?? '');
      const type = String(row._id?.type ?? '');
      if (!textbook || !type) continue;

      textbookSet.add(textbook);
      typeSet.add(type);

      const statusMap: Record<string, number> = {};
      for (const s of (row.byStatus as { status: string; count: number }[])) {
        statusMap[s.status] = (statusMap[s.status] ?? 0) + s.count;
      }

      data.push({
        textbook,
        type,
        total: Number(row.total ?? 0),
        완료: statusMap['완료'] ?? 0,
        대기: statusMap['대기'] ?? 0,
        검수불일치: statusMap['검수불일치'] ?? 0,
        기타: Object.entries(statusMap)
          .filter(([k]) => !['완료', '대기', '검수불일치'].includes(k))
          .reduce((s, [, v]) => s + v, 0),
      });
    }

    // 유형 순서: BOOK_VARIANT_QUESTION_TYPES 순으로 정렬
    const TYPE_ORDER = [
      '주제', '제목', '주장', '일치', '불일치', '함의',
      '빈칸', '요약', '어법', '순서', '삽입', '무관한문장', '삽입-고난도',
    ];
    const sortedTypes = [...typeSet].sort(
      (a, b) => (TYPE_ORDER.indexOf(a) === -1 ? 999 : TYPE_ORDER.indexOf(a))
             - (TYPE_ORDER.indexOf(b) === -1 ? 999 : TYPE_ORDER.indexOf(b))
    );

    // 교재는 총합 내림차순
    const textbookTotals: Record<string, number> = {};
    for (const d of data) {
      textbookTotals[d.textbook] = (textbookTotals[d.textbook] ?? 0) + d.total;
    }
    const sortedTextbooks = [...textbookSet].sort(
      (a, b) => (textbookTotals[b] ?? 0) - (textbookTotals[a] ?? 0)
    );

    return NextResponse.json({
      textbooks: sortedTextbooks,
      types: sortedTypes,
      rows: data,
      textbookTotals,
    });
  } catch (e) {
    console.error('generated-questions stats GET:', e);
    return NextResponse.json({ error: '집계 실패' }, { status: 500 });
  }
}
