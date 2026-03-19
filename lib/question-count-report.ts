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

export type UnderfilledRow = {
  passageId: string;
  label: string;
  type: string;
  count: number;
  required: number;
  shortBy: number;
};

/**
 * passage_id → (type → count) 맵을 사용해 지문별 미충족 목록 생성.
 */
export function buildQuestionCountReport(
  passages: PassageLean[],
  countMap: Map<string, Map<string, number>>,
  typesToCheck: readonly string[],
  requiredPerType: number,
  textbookFallback: string
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

    if (totalDocs === 0) {
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
