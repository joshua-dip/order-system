/** 부교재·모의고사 변형 주문에서 쓰는 표준 유형(카테고리) */
export const BOOK_VARIANT_QUESTION_TYPES = [
  '주제',
  '제목',
  '주장',
  '일치',
  '불일치',
  '함의',
  '빈칸',
  '요약',
  '어법',
  '어휘',
  '워크북어법',
  '순서',
  '삽입',
  '무관한문장',
  '삽입-고난도',
  '어법-고난도',
  '빈칸-고난도',
  '어휘-고난도',
  '순서-고난도',
  '요약-고난도',
  '무관한문장-고난도',
  '함의-고난도',
  '주제-고난도',
  '제목-고난도',
  '주장-고난도',
  '일치-고난도',
  '불일치-고난도',
] as const;

export type BookVariantQuestionType = (typeof BOOK_VARIANT_QUESTION_TYPES)[number];

/** 워크북 계열을 제외한 변형문제 유형 (변형문제 관리 화면용) */
export const BOOK_VARIANT_OBJECTIVE_TYPES = BOOK_VARIANT_QUESTION_TYPES.filter(
  (t) => !t.startsWith('워크북'),
);

/** 동일 원문·강·유형 조합당 권장 문항 수 */
export const DEFAULT_QUESTIONS_PER_VARIANT_TYPE = 3;

/**
 * 학교시험 분석 유형명 → 변형 DB 유형명(별칭) 매핑.
 * 학교시험은 `내용일치`/`내용불일치`/`요지`로 기록하지만 변형 DB 의 type 은 `일치`/`불일치`/`주장`.
 */
export const VARIANT_TYPE_ALIASES: Record<string, string> = {
  내용일치: '일치',
  내용불일치: '불일치',
  요지: '주장',
};

/**
 * 요청 유형(학교시험·변형 어느 어휘든) → 실제로 조회할 변형 DB 유형 목록.
 * 별칭을 정규화하고, 기본형이면 그 고난도형(`-고난도`)까지 후보에 포함한다.
 *   '어법'   → ['어법', '어법-고난도']
 *   '내용일치' → ['일치', '일치-고난도']
 *   '빈칸-고난도' → ['빈칸-고난도']   (이미 고난도면 그대로)
 */
export function expandVariantTypes(type: string): string[] {
  const t = (VARIANT_TYPE_ALIASES[type] ?? type ?? '').trim();
  if (!t) return [];
  if (t.endsWith('-고난도')) return [t];
  return [t, `${t}-고난도`];
}
