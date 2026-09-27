import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { countQuestionsByPassageType, emptyStatusCounts, loadPulledPassages, type StatusCounts } from '@/lib/exam-origin-stats';

export const dynamic = 'force-dynamic';

/**
 * 교재 × 유형 × 상태 집계.
 * 응답: { textbooks: string[], types: string[], rows: StatsRow[] }
 * StatsRow: { textbook, type, total, 완료, 대기, 검수불일치 }
 *
 * 끌어오기: 기출 지문이 있는 교재는 원출처 지문의 문항 수를 pulledRows 로 따로 준다.
 * rows·textbookTotals 는 자체 문항만 — 끌어온 문항은 원출처 교재에 이미 세어져 있으니 합계에 넣지 않는다.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');

    const pipeline = [
      { $match: { type: { $ne: '워크북어법' } } },
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
      '빈칸', '요약', '어법', '어휘', '순서', '삽입', '무관한문장', '삽입-고난도', '어법-고난도',
      '빈칸-고난도', '어휘-고난도', '순서-고난도', '요약-고난도', '무관한문장-고난도', '함의-고난도',
      '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
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

    /* 끌어온 문항 — 기출 지문(교재별)마다 원출처 지문의 문항을 센다. 같은 원출처를 두 번 끌어와도 한 번만. */
    const pulled = await loadPulledPassages(db);
    const perPassage = await countQuestionsByPassageType(db, pulled.map((o) => o.originId));
    const pulledByTbType = new Map<string, StatusCounts>();
    const pulledPassageCounts: Record<string, number> = {};
    const seenOrigin = new Set<string>();
    for (const o of pulled) {
      pulledPassageCounts[o.viaTextbook] = (pulledPassageCounts[o.viaTextbook] ?? 0) + 1;
      const key = `${o.viaTextbook}|${o.originId.toHexString()}`;
      if (seenOrigin.has(key)) continue;
      seenOrigin.add(key);
      for (const [type, c] of perPassage.get(o.originId.toHexString()) ?? []) {
        const k = `${o.viaTextbook}|${type}`;
        const acc = pulledByTbType.get(k) ?? pulledByTbType.set(k, emptyStatusCounts()).get(k)!;
        acc.total += c.total; acc.완료 += c.완료; acc.대기 += c.대기; acc.검수불일치 += c.검수불일치; acc.기타 += c.기타;
      }
    }
    const pulledRows = [...pulledByTbType].map(([k, c]) => {
      const [textbook, type] = k.split('|');
      return { textbook, type, ...c };
    });
    const pulledTotals: Record<string, number> = {};
    for (const r of pulledRows) pulledTotals[r.textbook] = (pulledTotals[r.textbook] ?? 0) + r.total;
    for (const tb of Object.keys(pulledPassageCounts)) textbookSet.add(tb);

    /* 정렬은 자체+끌어옴 기준 — 기출 교재가 맨 아래로 가라앉지 않게. 합계에는 넣지 않는다. */
    const sortWeight = (tb: string) => (textbookTotals[tb] ?? 0) + (pulledTotals[tb] ?? 0);
    const sortedTextbooks = [...textbookSet].sort((a, b) => sortWeight(b) - sortWeight(a));

    return NextResponse.json({
      textbooks: sortedTextbooks,
      types: sortedTypes,
      rows: data,
      textbookTotals,
      pulledRows,
      pulledTotals,
      pulledPassageCounts,
    });
  } catch (e) {
    console.error('generated-questions stats GET:', e);
    return NextResponse.json({ error: '집계 실패' }, { status: 500 });
  }
}
