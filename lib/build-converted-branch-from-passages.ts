/**
 * MongoDB passages 의 chapter / number / order 로
 * 단어장·주문 화면이 기대하는 병합 교재 트리(Sheet1 → 부교재 → 교재명 → 강 → 번호[])를 만듭니다.
 * (관리자 API passage-upload/from-passages 와 동일 규칙)
 */

export type PassageRow = { chapter?: unknown; number?: unknown; order?: unknown };

export type MergedTextbookBranch = {
  Sheet1: {
    부교재: Record<string, Record<string, { 번호: string }[]>>;
  };
};

/**
 * `merged[textbook]` 노드에서 강·번호 인덱스(부교재[textbook])가 비어 있지 않은지.
 * Sheet1 / 지문 데이터 / 최상위 부교재 등 레거시 형태를 모두 허용합니다.
 */
export function convertedMergedHasTextbookLessonIndex(
  merged: Record<string, unknown>,
  textbook: string,
): boolean {
  const entry = merged[textbook];
  const lessonMap = getLessonMapFromMergedTextbookEntry(entry, textbook);
  if (!lessonMap) return false;
  for (const v of Object.values(lessonMap)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    const anyNum = v.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        String((item as { 번호?: unknown }).번호 ?? '').trim().length > 0,
    );
    if (anyNum) return true;
  }
  return false;
}

function getLessonMapFromMergedTextbookEntry(
  entry: unknown,
  textbook: string,
): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  const sheet = (e.Sheet1 ?? e['지문 데이터']) as Record<string, unknown> | undefined;
  const 부 = (sheet?.부교재 ?? e.부교재) as Record<string, unknown> | undefined;
  if (!부 || typeof 부 !== 'object') return null;
  const tbNode = 부[textbook];
  if (!tbNode || typeof tbNode !== 'object' || Array.isArray(tbNode)) return null;
  return tbNode as Record<string, unknown>;
}

export function buildMergedTextbookBranchFromPassages(
  textbook: string,
  docs: PassageRow[],
): { branch: MergedTextbookBranch; lessonCount: number; passageCount: number } | null {
  const byChapter = new Map<string, Map<string, { order: number }>>();
  for (const p of docs) {
    const chRaw = String(p.chapter ?? '').trim();
    const ch = chRaw || '(강 미지정)';
    const num = String(p.number ?? '').trim();
    if (!num) continue;
    const ord =
      typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : 1_000_000;
    if (!byChapter.has(ch)) byChapter.set(ch, new Map());
    const inner = byChapter.get(ch)!;
    const prev = inner.get(num);
    if (!prev || ord < prev.order) inner.set(num, { order: ord });
  }

  const lessonKeys = [...byChapter.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  if (lessonKeys.length === 0) return null;

  const 부교재Inner: Record<string, Record<string, { 번호: string }[]>> = {};
  부교재Inner[textbook] = {};

  for (const lesson of lessonKeys) {
    const nums = byChapter.get(lesson)!;
    const entries = [...nums.entries()].sort((a, b) => {
      const o = a[1].order - b[1].order;
      if (o !== 0) return o;
      return a[0].localeCompare(b[0], 'ko');
    });
    부교재Inner[textbook][lesson] = entries.map(([n]) => ({ 번호: n }));
  }

  const branch: MergedTextbookBranch = {
    Sheet1: {
      부교재: 부교재Inner,
    },
  };

  const passageCount = docs.filter((p) => String(p.number ?? '').trim()).length;
  return { branch, lessonCount: lessonKeys.length, passageCount };
}
