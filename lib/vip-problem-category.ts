/**
 * VIP 문제은행 카테고리(객관식/주관식/선택형) 공용 판별.
 * - 문법(vip_grammar_problems)·라이팅(vip_writing_problems) 공통. API 필터·배지·백필에 사용.
 * - category 는 문제의 "형식" 대분류. 세부 유형은 type 필드(배열·영작·빈칸·고쳐쓰기·선택형·객관식…)로 별도 유지.
 *
 * 규칙(우선순위):
 *   1) type === '선택형'               → 선택형 (( A, B ) 중 정답 고르기, 2지선다)
 *   2) 보기 4지선다(options≥3) 또는 정답이 동그라미숫자 또는 type==='객관식' → 객관식
 *   3) 그 외(보기 없음·직접 서술) → 주관식 (배열·영작·조건영작·빈칸 등)
 */
export type ProblemCategory = '객관식' | '주관식' | '선택형';

export const PROBLEM_CATEGORIES: ProblemCategory[] = ['객관식', '주관식', '선택형'];

export function isProblemCategory(v: unknown): v is ProblemCategory {
  return typeof v === 'string' && (PROBLEM_CATEGORIES as string[]).includes(v);
}

export function deriveProblemCategory(d: { type?: unknown; options?: unknown; answer?: unknown }): ProblemCategory {
  const type = String(d.type ?? '').trim();
  if (type === '선택형') return '선택형';
  const opts = Array.isArray(d.options) ? d.options.length : 0;
  const isCircled = /^[①②③④⑤]$/.test(String(d.answer ?? '').trim());
  if (opts >= 3 || isCircled || type === '객관식') return '객관식';
  return '주관식';
}
