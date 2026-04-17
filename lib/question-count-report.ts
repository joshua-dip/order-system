import type { ObjectId } from 'mongodb';

export type PassageLean = {
  _id: ObjectId;
  textbook?: unknown;
  chapter?: unknown;
  number?: unknown;
  source_key?: unknown;
};

export type NoQuestionRow = {
  passageId: string;
  textbook: string;
  chapter: unknown;
  number: unknown;
  source_key: unknown;
  label: string;
};

export type UnderfilledStatusBreakdown = {
  완료: number;
  대기: number;
  /** 재시도 검수 등으로 표시 — 문항 품질 의심 시 */
  검수불일치: number;
  기타: number;
};

export type UnderfilledRow = {
  passageId: string;
  label: string;
  type: string;
  count: number;
  required: number;
  shortBy: number;
  /** questionStatusScope가 all일 때만: 해당 지문×유형 변형문의 status별 건수(합=count) */
  statusBreakdown?: UnderfilledStatusBreakdown;
};

/**
 * passage_id → (type → count) 맵을 사용해 지문별 미충족 목록 생성.
 */
export function buildQuestionCountReport(
  passages: PassageLean[],
  countMap: Map<string, Map<string, number>>,
  typesToCheck: readonly string[],
  requiredPerType: number,
  textbookFallback: string,
  /** 지문당 변형문 총건(option_type 무관). 있으면 `countMap`이 English만 집계일 때도 미생성 오판을 막는다. */
  passageAnyDocCount?: Map<string, number> | null
): { noQuestionsFull: NoQuestionRow[]; underfilledFull: UnderfilledRow[] } {
  const noQuestionsFull: NoQuestionRow[] = [];
  const underfilledFull: UnderfilledRow[] = [];

  for (const p of passages) {
    const pid = String(p._id);
    const typeCounts = countMap.get(pid);
    const totalDocs = typeCounts
      ? [...typeCounts.values()].reduce((a, b) => a + b, 0)
      : 0;
    const label =
      (typeof p.source_key === 'string' && p.source_key.trim()) ||
      `${String(p.chapter ?? '')} ${String(p.number ?? '')}`.trim() ||
      pid;

    const anyPassage =
      passageAnyDocCount != null ? (passageAnyDocCount.get(pid) ?? 0) > 0 : totalDocs > 0;
    if (!anyPassage) {
      noQuestionsFull.push({
        passageId: pid,
        textbook: String(p.textbook ?? textbookFallback),
        chapter: p.chapter,
        number: p.number,
        source_key: p.source_key,
        label,
      });
      continue;
    }

    for (const typ of typesToCheck) {
      const c = typeCounts?.get(typ) ?? 0;
      if (c < requiredPerType) {
        underfilledFull.push({
          passageId: pid,
          label,
          type: typ,
          count: c,
          required: requiredPerType,
          shortBy: requiredPerType - c,
        });
      }
    }
  }

  return { noQuestionsFull, underfilledFull };
}
