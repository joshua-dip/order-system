/**
 * 변형도 분석·미리보기 건수 — `generated_questions`에 쓰는 MongoDB 필터 (교재·유형과 동일).
 */
export function buildVariationAnalysisFilter(textbook: string, typeFilter: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    passage_id: { $exists: true, $ne: null },
    'question_data.Paragraph': { $exists: true, $type: 'string' },
  };
  const tb = textbook?.trim();
  const ty = typeFilter?.trim();
  if (tb) filter.textbook = tb;
  if (ty) filter.type = ty;
  return filter;
}
