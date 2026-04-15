/**
 * 모의고사 변형 `generated_questions.source` 등 출처 라벨 통일.
 * - `교재명 · 34번` → `교재명 34번` (번호 앞 중점 제거, 공백 하나)
 * - 목록에서 `source_key — 챕터 · 번호`가 통째로 붙은 경우 → ` — ` 앞만 사용
 * 교재·출처 중 하나에 `모의고사`가 있을 때만 적용(부교재 `06강 · Gateway` 등은 그대로).
 */
export function normalizeMockVariantSourceLabel(textbook: string, source: string): string {
  let s = source.trim().replace(/\s+/g, ' ');
  const tb = textbook.trim();
  if (!tb.includes('모의고사') && !s.includes('모의고사')) return s;

  if (/\s+—\s+/.test(s)) {
    s = s.split(/\s+—\s+/)[0].trim();
  }
  s = s.replace(/\s*·\s*(\d{1,3}(?:~\d{1,3})?번)/g, ' $1');
  return s.replace(/\s+/g, ' ').trim();
}

/** DB에 남아 있을 수 있는 `… · N번` 형태까지 검색할 때 쓰는 동등 라벨 후보 */
export function mockExamSourceLabelAlternates(textbook: string, source: string): string[] {
  const n = normalizeMockVariantSourceLabel(textbook, source);
  const out = new Set<string>([n]);
  if (!n.includes('모의고사')) return [...out];
  const dotted = n.replace(/(\d{1,3}(?:~\d{1,3})?번)$/, ' · $1');
  if (dotted !== n) out.add(dotted);
  return [...out];
}
