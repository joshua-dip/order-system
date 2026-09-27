import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { addStatus, countQuestionsByPassageType, emptyStatusCounts, loadPulledPassages, type StatusCounts } from '@/lib/exam-origin-stats';

export const dynamic = 'force-dynamic';

/**
 * 특정 교재의 소스(지문)별 × 유형별 집계.
 * ?textbook=교재명  (exam_textbook= 도 같은 뜻으로 받는다 — 예전 기출기반 전용 파라미터)
 *
 * 자체 문항은 generated_questions.textbook·source 로 센다.
 * 기출 지문(original_passage_id / passage_source 로 원출처가 연결된 지문)은 문항을 원출처 지문에서 끌어오므로
 * 그 소스 줄은 원출처 지문의 문항 수를 보여 주고 pulledSources 에 「원출처」를 적는다.
 * 기출문제집은 전부, 기출이 섞인 부교재는 그 지문만 끌어옴이 된다.
 *
 * 응답: { textbook, sources, types, rows, sourceTotals, pulledSources, sourcePassageSource, ownTotal, pulledTotal, unmovedOnPulled }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const textbook = (searchParams.get('textbook') || searchParams.get('exam_textbook') || '').trim();
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');

    const [allPassageDocs, pulled, ownAgg] = await Promise.all([
      // passages 컬렉션에서 모든 source_key 미리 수집 (문항 0개인 소스도 표시)
      db.collection('passages').find({ textbook }).project({ _id: 0, source_key: 1 }).toArray(),
      loadPulledPassages(db, textbook),
      db.collection('generated_questions').aggregate([
        { $match: { textbook, type: { $ne: '워크북어법' } } },
        { $group: { _id: { source: '$source', type: '$type', status: '$status' }, count: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const sourceSet = new Set<string>();
    for (const p of allPassageDocs) {
      const sk = String(p.source_key ?? '').trim();
      if (sk) sourceSet.add(sk);
    }

    const TYPE_ORDER = [
      '주제', '제목', '주장', '일치', '불일치', '함의',
      '빈칸', '요약', '어법', '순서', '삽입', '무관한문장', '삽입-고난도', '어법-고난도',
    ];
    // 모든 표준 유형을 미리 포함 (0개 유형도 컬럼으로 표시)
    const typeSet = new Set<string>(TYPE_ORDER);

    /** 끌어오는 소스 → 원출처 표기 */
    const pulledSources: Record<string, string> = {};
    for (const o of pulled) {
      if (!o.viaSourceKey) continue;
      pulledSources[o.viaSourceKey] = [o.originTextbook, o.originSourceKey].filter(Boolean).join(' · ') || o.originSourceKey;
      sourceSet.add(o.viaSourceKey);
    }

    const cells = new Map<string, StatusCounts>();
    const cell = (source: string, type: string) => {
      const k = `${source}\u0000${type}`;
      return cells.get(k) ?? cells.set(k, emptyStatusCounts()).get(k)!;
    };

    /** 끌어오는 지문에 아직 남아 있는 자체 문항(원출처로 옮기기 전) — 집계에는 넣지 않고 따로 알린다 */
    const unmovedOnPulled: Record<string, number> = {};
    let ownTotal = 0;
    for (const r of ownAgg) {
      const source = String(r._id?.source ?? '');
      const type = String(r._id?.type ?? '');
      if (!source || !type) continue;
      const n = Number(r.count ?? 0);
      if (pulledSources[source]) {
        unmovedOnPulled[source] = (unmovedOnPulled[source] ?? 0) + n;
        continue;
      }
      sourceSet.add(source);
      typeSet.add(type);
      addStatus(cell(source, type), r._id?.status, n);
      ownTotal += n;
    }

    let pulledTotal = 0;
    const perPassage = await countQuestionsByPassageType(db, pulled.map((o) => o.originId));
    for (const o of pulled) {
      if (!o.viaSourceKey) continue;
      for (const [type, c] of perPassage.get(o.originId.toHexString()) ?? []) {
        typeSet.add(type);
        const acc = cell(o.viaSourceKey, type);
        acc.total += c.total; acc.완료 += c.완료; acc.대기 += c.대기; acc.검수불일치 += c.검수불일치; acc.기타 += c.기타;
        pulledTotal += c.total;
      }
    }

    const data = [...cells].map(([k, c]) => {
      const [source, type] = k.split('\u0000');
      return { source, type, ...c, ...(pulledSources[source] ? { pulled: true } : {}) };
    });

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
      pulledSources,
      /** 예전 화면 호환 — 소스 옆에 원출처를 적던 필드 */
      sourcePassageSource: pulledSources,
      ownTotal,
      pulledTotal,
      unmovedOnPulled,
    });
  } catch (e) {
    console.error('generated-questions stats/source GET:', e);
    return NextResponse.json({ error: '집계 실패' }, { status: 500 });
  }
}
