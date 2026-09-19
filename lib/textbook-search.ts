/**
 * 교재 이름 검색 — 주문 화면들의 「교재명으로 검색」 공용 규칙.
 *
 * 그냥 `includes` 로 찾으면 두 가지가 틀렸다(2026-09-19 지적).
 *  1. 교과서 키는 로마 숫자다(`영어II_천재강상구`). 「영어2」로 치면 영어II 는 하나도 안 나온다.
 *  2. 거꾸로 「영어2」가 `공통영어2_…` 안쪽에 걸려 공통영어2 만 줄줄이 나온다.
 *     공통영어2(고1)와 영어II(고2)는 다른 과목이라 섞이면 안 된다.
 *
 * 규칙: 공백·대소문자 무시 · 영어I/II/Ⅰ/Ⅱ 를 영어1/2 로 맞춤 ·
 * 「영어1」「영어2」처럼 과목 번호까지 쓴 검색어는 `공통영어…` 안쪽 일치를 인정하지 않는다 —
 * 공통영어는 「공통영어2」로 쳐야 나온다. 「영어」만 치면 둘 다 나온다.
 * 먼저 검색어 전체를 붙여 쓴 구절로 찾고, 하나도 없을 때만 띄어 쓴 낱말별로(AND) 찾는다 —
 * 「영어 독해」는 영어 독해와 작문만, 「영어2 강상구」는 영어II_천재강상구를 찾는다.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/영어(ⅱ|ii)/g, '영어2')
    .replace(/영어(ⅰ|i)(?![a-z])/g, '영어1');
}

/** 「영어 2」「공통 영어2」처럼 과목명 안을 띄어 써도 한 덩어리로 본다 */
function joinSubjectSpacing(query: string): string {
  return query
    .trim()
    .replace(/공통\s+영어/g, '공통영어')
    .replace(/영어\s+(?=(ⅱ|ⅰ|ii|i|[12])(?![a-z가-힣]))/gi, '영어');
}

/** 검색어 한 조각이 교재 이름에 들어 있는가 — 과목 번호로 시작하면 「공통」 뒤 일치는 건너뛴다 */
function fragmentMatches(normalizedKey: string, fragment: string): boolean {
  const levelFragment = /^영어[12]/.test(fragment);
  let from = 0;
  for (;;) {
    const i = normalizedKey.indexOf(fragment, from);
    if (i < 0) return false;
    if (levelFragment && normalizedKey.slice(Math.max(0, i - 2), i) === '공통') {
      from = i + 1;
      continue;
    }
    return true;
  }
}

/** 교재 목록을 검색어로 거른다. 검색어가 비면 그대로 돌려준다. */
export function filterTextbooksBySearch(keys: string[], query: string): string[] {
  const joined = joinSubjectSpacing(query);
  if (!joined) return keys;
  const normalized = keys.map((k) => ({ k, n: normalize(k) }));

  const phrase = normalize(joined);
  const byPhrase = normalized.filter(({ n }) => fragmentMatches(n, phrase)).map(({ k }) => k);
  if (byPhrase.length > 0) return byPhrase;

  const tokens = joined.split(/\s+/).map(normalize).filter(Boolean);
  if (tokens.length < 2) return byPhrase;
  return normalized.filter(({ n }) => tokens.every((t) => fragmentMatches(n, t))).map(({ k }) => k);
}
