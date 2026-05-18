import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { auditContent } from '@/lib/essay-exam-content-audit';

export const dynamic = 'force-dynamic';

const DIFFICULTIES = ['기본난도', '중난도', '고난도', '최고난도'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

/** doc-level audit 결과 캐시. key=_id, value={hasErr, updatedAt}.
 *  updatedAt 변경 시 자동 invalidation. 모듈-수준이므로 프로세스 종료까지 유지. */
const AUDIT_CACHE = new Map<string, { hasErr: boolean; updatedAt: number }>();

interface TextbookCoverage {
  textbook: string;
  passages_total: number;
  /** 어떤 난이도라도 1 건 이상 만들어진 지문 수 (rounds 무관 — 옛 기준 호환) */
  passages_with_any: number;
  /** 4 난이도 모두 `rounds` 건 이상 만족한 지문 수 */
  passages_with_target: number;
  exams_total: number;
  pinned_total: number;
  by_difficulty: Record<Difficulty, number>;
  /** audit-content 통과 (ERROR 0건) 항목 수 */
  audit_clean: number;
  /** audit-content ERROR 보유 항목 수 */
  audit_with_errors: number;
}

/**
 * GET /api/admin/essay-generator/coverage?rounds=1
 *
 * 교재별 서술형 출제기 진행 현황 요약.
 * `rounds` (기본 1): 각 난이도 N 건씩 채우는 회분 수. 응답의 `passages_with_target` 가 이 기준.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const url = new URL(request.url);
  const rounds = Math.max(1, Math.min(20, Math.floor(Number(url.searchParams.get('rounds') ?? '1') || 1)));

  try {
    const db = await getDb('gomijoshua');

    const passageAgg = await db
      .collection('passages')
      .aggregate([
        { $match: { textbook: { $exists: true, $ne: '' } } },
        {
          $group: {
            _id: '$textbook',
            passages_total: { $sum: 1 },
            pinned_total: {
              $sum: { $cond: [{ $gt: ['$essayPriority', 0] }, 1, 0] },
            },
          },
        },
      ])
      .toArray();

    const examAgg = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { isPlaceholder: { $ne: true }, textbook: { $ne: '' } } },
        {
          $group: {
            _id: { textbook: '$textbook', difficulty: '$difficulty' },
            count: { $sum: 1 },
            passageKeys: {
              $addToSet: {
                $cond: [
                  { $ifNull: ['$passageId', false] },
                  '$passageId',
                  '$sourceKey',
                ],
              },
            },
          },
        },
      ])
      .toArray();

    /* textbook → coverage 누적 */
    const byTextbook = new Map<string, TextbookCoverage>();

    for (const row of passageAgg) {
      const tb = String(row._id ?? '').trim();
      if (!tb) continue;
      byTextbook.set(tb, {
        textbook: tb,
        passages_total: Number(row.passages_total ?? 0),
        passages_with_any: 0,
        passages_with_target: 0,
        exams_total: 0,
        pinned_total: Number(row.pinned_total ?? 0),
        by_difficulty: { 기본난도: 0, 중난도: 0, 고난도: 0, 최고난도: 0 },
        audit_clean: 0,
        audit_with_errors: 0,
      });
    }

    /* textbook 별로 "1개 이상 만들어진 지문" 카운트를 위해
       passageId/sourceKey set 의 합집합을 구한다 */
    const passageKeysByTb = new Map<string, Set<string>>();

    for (const row of examAgg) {
      const tb = String(row._id?.textbook ?? '').trim();
      const diff = String(row._id?.difficulty ?? '') as Difficulty;
      if (!tb) continue;

      let entry = byTextbook.get(tb);
      if (!entry) {
        entry = {
          textbook: tb,
          passages_total: 0,
          passages_with_any: 0,
          passages_with_target: 0,
          exams_total: 0,
          pinned_total: 0,
          by_difficulty: { 기본난도: 0, 중난도: 0, 고난도: 0, 최고난도: 0 },
          audit_clean: 0,
          audit_with_errors: 0,
        };
        byTextbook.set(tb, entry);
      }

      const count = Number(row.count ?? 0);
      entry.exams_total += count;
      if (DIFFICULTIES.includes(diff)) {
        entry.by_difficulty[diff] = (entry.by_difficulty[diff] ?? 0) + count;
      }

      let set = passageKeysByTb.get(tb);
      if (!set) {
        set = new Set();
        passageKeysByTb.set(tb, set);
      }
      for (const key of (row.passageKeys ?? []) as string[]) {
        if (key) set.add(String(key));
      }
    }

    for (const [tb, set] of passageKeysByTb) {
      const entry = byTextbook.get(tb);
      if (entry) entry.passages_with_any = set.size;
    }

    /* 회분 수 기준 충족 지문 수: textbook 별로 passageKey → 난이도별 카운트 후 모두 rounds 이상이면 +1 */
    const targetAgg = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { isPlaceholder: { $ne: true }, textbook: { $ne: '' } } },
        {
          $group: {
            _id: {
              textbook: '$textbook',
              passageKey: {
                $cond: [{ $ifNull: ['$passageId', false] }, '$passageId', '$sourceKey'],
              },
              difficulty: '$difficulty',
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    /** textbook → passageKey → diff count map */
    const passageDiffMap = new Map<string, Map<string, Record<Difficulty, number>>>();
    for (const row of targetAgg) {
      const tb = String(row._id?.textbook ?? '').trim();
      const pk = String(row._id?.passageKey ?? '').trim();
      const diff = String(row._id?.difficulty ?? '') as Difficulty;
      if (!tb || !pk || !DIFFICULTIES.includes(diff)) continue;
      let perTb = passageDiffMap.get(tb);
      if (!perTb) {
        perTb = new Map();
        passageDiffMap.set(tb, perTb);
      }
      let perPassage = perTb.get(pk);
      if (!perPassage) {
        perPassage = { 기본난도: 0, 중난도: 0, 고난도: 0, 최고난도: 0 };
        perTb.set(pk, perPassage);
      }
      perPassage[diff] += Number(row.count ?? 0);
    }
    for (const [tb, perTb] of passageDiffMap) {
      const entry = byTextbook.get(tb);
      if (!entry) continue;
      let withTarget = 0;
      for (const counts of perTb.values()) {
        if (DIFFICULTIES.every(d => counts[d] >= rounds)) withTarget += 1;
      }
      entry.passages_with_target = withTarget;
    }

    /* audit-content 통계 — textbook 별로 ERROR 보유/클린 집계.
       doc-level 캐시: _id 기준, updatedAt 변경 시 자동 invalidation.
       2-step fetch: 1) 가벼운 _id+updatedAt+textbook 만 / 2) cache miss 만 data fetch */
    const lightDocs = await db
      .collection('essay_exams')
      .find(
        { isPlaceholder: { $ne: true }, textbook: { $ne: '' } },
        { projection: { _id: 1, updatedAt: 1, textbook: 1 } },
      )
      .toArray();

    const tsOf = (d: unknown): number => {
      const u = (d as { updatedAt?: Date | string | number }).updatedAt;
      if (u instanceof Date) return u.getTime();
      if (typeof u === 'string') return new Date(u).getTime();
      if (typeof u === 'number') return u;
      return 0;
    };

    /* cache miss 인 _id 추출 */
    const missIds: string[] = [];
    for (const d of lightDocs) {
      const id = String(d._id);
      const ts = tsOf(d);
      const cached = AUDIT_CACHE.get(id);
      if (!cached || cached.updatedAt !== ts) missIds.push(id);
    }

    if (missIds.length > 0) {
      const oids = missIds.map(id => new ObjectId(id));
      const fullDocs = await db
        .collection('essay_exams')
        .find({ _id: { $in: oids } }, { projection: { _id: 1, data: 1 } })
        .toArray();
      const tsById = new Map<string, number>(lightDocs.map(d => [String(d._id), tsOf(d)]));
      for (const raw of fullDocs) {
        const id = String(raw._id);
        try {
          const result = auditContent({ ...raw, _id: id } as never);
          const hasErr = result.findings.some(f => f.level === 'error');
          AUDIT_CACHE.set(id, { hasErr, updatedAt: tsById.get(id) ?? 0 });
        } catch {
          /* 실패는 무시 — 캐시 미저장 (다음 호출에 재시도) */
        }
      }
    }

    /* 모든 doc 의 결과 집계 (캐시 사용) */
    for (const d of lightDocs) {
      const tb = String((d as { textbook?: string }).textbook ?? '').trim();
      if (!tb) continue;
      const entry = byTextbook.get(tb);
      if (!entry) continue;
      const c = AUDIT_CACHE.get(String(d._id));
      if (!c) continue;
      if (c.hasErr) entry.audit_with_errors++;
      else entry.audit_clean++;
    }

    const items = [...byTextbook.values()]
      .filter(e => e.passages_total > 0 || e.exams_total > 0)
      .sort((a, b) => a.textbook.localeCompare(b.textbook, 'ko'));

    return NextResponse.json({ items, difficulties: DIFFICULTIES, rounds });
  } catch (e) {
    console.error('[essay-generator coverage]', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}
