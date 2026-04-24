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
  '워크북어법',
  '순서',
  '삽입',
  '무관한문장',
  '삽입-고난도',
] as const;

export type BookVariantQuestionType = (typeof BOOK_VARIANT_QUESTION_TYPES)[number];

/** 워크북 계열을 제외한 변형문제 유형 (변형문제 관리 화면용) */
export const BOOK_VARIANT_OBJECTIVE_TYPES = BOOK_VARIANT_QUESTION_TYPES.filter(
  (t) => !t.startsWith('워크북'),
);

/** 동일 원문·강·유형 조합당 권장 문항 수 */
export const DEFAULT_QUESTIONS_PER_VARIANT_TYPE = 3;
