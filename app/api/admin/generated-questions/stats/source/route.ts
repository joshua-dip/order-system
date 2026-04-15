import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * 특정 교재의 소스(지문)별 × 유형별 집계.
 * ?textbook=교재명
 * 응답: { sources: string[], types: string[], rows: SourceStatsRow[] }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const textbook = searchParams.get('textbook')?.trim() ?? '';
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');

    const pipeline = [
      { $match: { textbook } },
      {
        $group: {
          _id: { source: '$source', type: '$type', status: '$status' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: { source: '$_id.source', type: '$_id.type' },
          total: { $sum: '$count' },
          byStatus: { $push: { status: '$_id.status', count: '$count' } },
        },
      },
      { $sort: { '_id.source': 1, '_id.type': 1 } },
    ];

    const rows = await db.collection('generated_questions').aggregate(pipeline).toArray();

    const sourceSet = new Set<string>();
    const typeSet = new Set<string>();
    const data: {
      source: string;
      type: string;
      total: number;
      완료: number;
      대기: number;
      검수불일치: number;
      기타: number;
    }[] = [];

    for (const row of rows) {
      const source = String(row._id?.source ?? '');
      const type = String(row._id?.type ?? '');
      if (!source || !type) continue;

      sourceSet.add(source);
      typeSet.add(type);

      const statusMap: Record<string, number> = {};
      for (const s of (row.byStatus as { status: string; count: number }[])) {
        statusMap[s.status] = (statusMap[s.status] ?? 0) + s.count;
      }

      data.push({
        source,
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

    const TYPE_ORDER = [
      '주제', '제목', '주장', '일치', '불일치', '함의',
      '빈칸', '요약', '어법', '순서', '삽입', '무관한문장', '삽입-고난도',
    ];

    // 소스 정렬: 자연 정렬 (01강 01번, 01강 02번 ... 02강 01번)
    const naturalSort = (a: string, b: string) =>
      a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });

    const sortedSources = [...sourceSet].sort(naturalSort);
    const sortedTypes = [...typeSet].sort(
      (a, b) =>
        (TYPE_ORDER.indexOf(a) === -1 ? 999 : TYPE_ORDER.indexOf(a)) -
        (TYPE_ORDER.indexOf(b) === -1 ? 999 : TYPE_ORDER.indexOf(b))
    );

    // 소스별 총합
    const sourceTotals: Record<string, number> = {};
    for (const d of data) {
      sourceTotals[d.source] = (sourceTotals[d.source] ?? 0) + d.total;
    }

    return NextResponse.json({
      textbook,
      sources: sortedSources,
      types: sortedTypes,
      rows: data,
      sourceTotals,
    });
  } catch (e) {
    console.error('generated-questions stats/source GET:', e);
    return NextResponse.json({ error: '집계 실패' }, { status: 500 });
  }
}
