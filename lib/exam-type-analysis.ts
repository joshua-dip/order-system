import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';

/** 기출 유형 분석 요청 컬렉션 — 사용자 요청 + 관리자 추천 유형 세트 */
export const EXAM_TYPE_ANALYSIS_COLLECTION = 'exam_type_analysis_requests';

export type RecommendedType = { type: string; count: number };

export function parseRecommendedTypes(raw: unknown): RecommendedType[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(BOOK_VARIANT_QUESTION_TYPES as readonly string[]);
  const out: RecommendedType[] = [];
  for (const r of raw) {
    const type = typeof (r as { type?: unknown })?.type === 'string' ? String((r as { type: string }).type).trim() : '';
    const countRaw = (r as { count?: unknown })?.count;
    const count = typeof countRaw === 'number' ? Math.floor(countRaw) : 0;
    if (allowed.has(type) && count >= 1 && count <= 10) out.push({ type, count });
  }
  return out;
}
