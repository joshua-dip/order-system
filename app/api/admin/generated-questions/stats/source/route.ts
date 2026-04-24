import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * 특정 교재의 소스(지문)별 × 유형별 집계.
 * ?textbook=교재명  (일반 교재: generated_questions.textbook 기준)
 * ?exam_textbook=교재명  (기출기반 교재: passages.original_passage_id 기준, 결과 source_key 표시)
 * 응답: { textbook, sources: string[], types: string[], rows: SourceStatsRow[], sourceTotals }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const textbook = searchParams.get('textbook')?.trim() ?? '';
  const examTextbook = searchParams.get('exam_textbook')?.trim() ?? '';
  if (!textbook && !examTextbook) {
    return NextResponse.json({ error: 'textbook 또는 exam_textbook 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');

    /** 기출기반 교재: passages.original_passage_id → source_key 매핑 후 집계 */
    if (examTextbook) {
      // ── Step 1: source_key 전체 수집 (aggregate $group) + 개별 passage 목록 ──
      const [sourceKeyDocs, allPassageDocs] = await Promise.all([
        db.collection('passages').aggregate([
          { $match: { textbook: examTextbook, source_key: { $exists: true, $nin: [null, ''] } } },
          { $group: { _id: '$source_key', passageSource: { $first: '$passage_source' } } },
        ]).toArray(),
        db.collection('passages')
          .find({ textbook: examTextbook })
          .project({ _id: 1, source_key: 1, original_passage_id: 1, passage_source: 1 })
          .toArray(),
      ]);

      // 모든 source_key를 sourceSet에 추가 (문항 0개인 소스도 표시)
      const sourceSet = new Set<string>();
      // sourceToPassageSource를 aggregate 결과로 미리 채움
      const sourceToPassageSource = new Map<string, string>();
      for (const doc of sourceKeyDocs) {
        const sk = String(doc._id ?? '').trim();
        if (!sk) continue;
        sourceSet.add(sk);
        const ps = String(doc.passageSource ?? '').trim();
        if (ps) sourceToPassageSource.set(sk, ps);
      }
      const psToSourceKey = new Map<string, string>();
      const origToSourceKey = new Map<string, string>();
      const queryIds: ObjectId[] = [];

      for (const p of allPassageDocs) {
        const sk = String(p.source_key ?? '').trim();
        if (!sk) continue;
        const ps = String((p as Record<string, unknown>).passage_source ?? '').trim();

        if (p.original_passage_id) {
          let origId: ObjectId;
          try {
            origId = p.original_passage_id instanceof ObjectId
              ? p.original_passage_id
              : new ObjectId(String(p.original_passage_id));
          } catch { origId = p._id as ObjectId; }
          origToSourceKey.set(origId.toHexString(), sk);
          queryIds.push(origId);
        } else if (ps) {
          if (!psToSourceKey.has(ps)) psToSourceKey.set(ps, sk);
        } else {
          origToSourceKey.set((p._id as ObjectId).toHexString(), sk);
          queryIds.push(p._id as ObjectId);
        }
      }

      // ── Step 2: passage_source → 원본 지문 _id 조회 ──
      if (psToSourceKey.size > 0) {
        const psKeys = [...psToSourceKey.keys()];
        const origDocs = await db
          .collection('passages')
          .find({ source_key: { $in: psKeys } })
          .project({ _id: 1, source_key: 1 })
          .toArray();
        for (const op of origDocs) {
          const opSk = String(op.source_key ?? '').trim();
          const mySk = psToSourceKey.get(opSk);
          if (mySk && !origToSourceKey.has((op._id as ObjectId).toHexString())) {
            origToSourceKey.set((op._id as ObjectId).toHexString(), mySk);
            queryIds.push(op._id as ObjectId);
          }
        }
      }

      const naturalSort = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });
      const TYPE_ORDER = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '순서', '삽입', '무관한문장', '삽입-고난도'];
      // 모든 표준 유형을 미리 포함 (0개 유형도 컬럼으로 표시)
      const typeSet = new Set<string>(TYPE_ORDER);
      const data: { source: string; type: string; total: number; 완료: number; 대기: number; 검수불일치: number; 기타: number }[] = [];

      if (queryIds.length > 0) {
        const agg = await db.collection('generated_questions').aggregate([
          { $match: { $or: [{ passage_id: { $in: queryIds } }, { passage_id: { $in: queryIds.map((id) => id.toString()) } }] } },
          { $addFields: { pidStr: { $toString: '$passage_id' } } },
          {
            $group: {
              _id: { pidStr: '$pidStr', type: '$type', status: '$status' },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: { pidStr: '$_id.pidStr', type: '$_id.type' },
              total: { $sum: '$count' },
              byStatus: { $push: { status: '$_id.status', count: '$count' } },
            },
          },
        ]).toArray();

        for (const row of agg) {
          const pidStr = String(row._id?.pidStr ?? '');
          const source = origToSourceKey.get(pidStr) ?? pidStr;
          const type = String(row._id?.type ?? '');
          if (!source || !type) continue;
          sourceSet.add(source);
          typeSet.add(type);
          const statusMap: Record<string, number> = {};
          for (const s of (row.byStatus as { status: string; count: number }[])) {
            statusMap[s.status] = (statusMap[s.status] ?? 0) + s.count;
          }
          data.push({
            source, type,
            total: Number(row.total ?? 0),
            완료: statusMap['완료'] ?? 0,
            대기: statusMap['대기'] ?? 0,
            검수불일치: statusMap['검수불일치'] ?? 0,
            기타: Object.entries(statusMap).filter(([k]) => !['완료', '대기', '검수불일치'].includes(k)).reduce((s, [, v]) => s + v, 0),
          });
        }
      }

      const sourceTotals: Record<string, number> = {};
      for (const d of data) sourceTotals[d.source] = (sourceTotals[d.source] ?? 0) + d.total;

      return NextResponse.json({
        textbook: examTextbook,
        sources: [...sourceSet].sort(naturalSort),
        types: [...typeSet].sort((a, b) => (TYPE_ORDER.indexOf(a) === -1 ? 999 : TYPE_ORDER.indexOf(a)) - (TYPE_ORDER.indexOf(b) === -1 ? 999 : TYPE_ORDER.indexOf(b))),
        rows: data,
        sourceTotals,
        sourcePassageSource: Object.fromEntries(sourceToPassageSource),
      });
    }

    // passages 컬렉션에서 모든 source_key 미리 수집 (문항 0개인 소스도 표시)
    const allPassageDocs = await db.collection('passages')
      .find({ textbook })
      .project({ _id: 0, source_key: 1 })
      .toArray();
    const sourceSet = new Set<string>();
    for (const p of allPassageDocs) {
      const sk = String(p.source_key ?? '').trim();
      if (sk) sourceSet.add(sk);
    }

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

    const TYPE_ORDER = [
      '주제', '제목', '주장', '일치', '불일치', '함의',
      '빈칸', '요약', '어법', '순서', '삽입', '무관한문장', '삽입-고난도',
    ];
    // 모든 표준 유형을 미리 포함 (0개 유형도 컬럼으로 표시)
    const typeSet = new Set<string>(TYPE_ORDER);
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
