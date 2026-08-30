/**
 * 주문의 교재명·지문 번호를 `passages` 표기와 맞춰 주는 보정.
 *
 * 주문서에 담긴 값과 원문 등록 표기가 미묘하게 어긋나는 일이 있다. 실제로 겪은 것:
 *
 *   교재명   주문 「531 PROJECT 유형독해S」   원문 「531 PROJECT 유형독해 S(2020)」
 *   번호     주문 「유형 Practice 1번」        원문 「유형 Practice 01번」
 *
 * 완전 일치로만 찾으면 77지문이 통째로 안 잡히고, 부족 집계가 **0** 으로 나온다.
 * 그러면 아무것도 만들지 않은 채 주문이 끝난 것처럼 보인다 — 조용해서 더 위험하다.
 *
 * 그래서 **완전 일치를 먼저 쓰고, 못 찾은 것만** 아래 규칙으로 한 번 더 찾는다.
 * 추측으로 엉뚱한 지문을 붙이지 않도록, 정규화 결과가 여러 개에 걸리면 포기한다.
 */

/** 교재명 비교용 — 공백과 「(2020)」 같은 연도 꼬리를 떼고 소문자로. */
export function normalizeTextbookName(s: string): string {
  return String(s ?? '')
    .replace(/\((?:19|20)\d{2}(?:[.\-/]\d{1,2})?\)/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/** 지문 키 비교용 — 공백을 하나로 줄이고 숫자의 앞 0 을 없앤다("01번"↔"1번"). */
export function normalizePassageKey(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d+)/g, (m) => String(parseInt(m, 10)))
    .toLowerCase();
}

/**
 * 정규화 이름이 같은 교재를 고른다. 완전히 같은 이름이 있으면 그것만 돌려준다
 * (연도만 다른 개정판이 여럿일 때 옛 판을 끌어오지 않도록).
 */
export function resolveTextbookCandidates(wanted: string, allTextbooks: string[]): string[] {
  const exact = allTextbooks.filter((t) => t.trim() === wanted.trim());
  if (exact.length > 0) return exact;
  const key = normalizeTextbookName(wanted);
  if (!key) return [];
  return allTextbooks.filter((t) => normalizeTextbookName(t) === key);
}

export interface PassageKeyIndexEntry {
  /** 정규화 키가 하나의 원문에만 걸릴 때 그 원문의 실제 source_key */
  sourceKey: string;
  /** 같은 정규화 키에 걸린 원문 수. 2 이상이면 애매해서 쓰지 않는다. */
  count: number;
}

/** 원문 source_key 들을 정규화 키로 색인한다. */
export function buildPassageKeyIndex(sourceKeys: string[]): Map<string, PassageKeyIndexEntry> {
  const idx = new Map<string, PassageKeyIndexEntry>();
  for (const raw of sourceKeys) {
    const k = normalizePassageKey(raw);
    if (!k) continue;
    const cur = idx.get(k);
    if (cur) cur.count += 1;
    else idx.set(k, { sourceKey: raw, count: 1 });
  }
  return idx;
}

/**
 * 못 찾은 주문 키들을 색인으로 되짚는다.
 *
 * @returns `resolved` 주문키 → 실제 source_key, `stillMissing` 끝내 못 찾은 주문키
 */
export function rescueMissingKeys(
  missing: string[],
  index: Map<string, PassageKeyIndexEntry>,
): { resolved: Map<string, string>; stillMissing: string[] } {
  const resolved = new Map<string, string>();
  const stillMissing: string[] = [];
  for (const key of missing) {
    const hit = index.get(normalizePassageKey(key));
    /* 여러 원문에 걸리면 어느 쪽인지 모른다 — 억지로 고르지 않는다. */
    if (hit && hit.count === 1) resolved.set(key, hit.sourceKey);
    else stillMissing.push(key);
  }
  return { resolved, stillMissing };
}
