/**
 * 서술형 주문용 대분류·소분류
 * - `ESSAY_ORDER_VISIBLE_MAIN_CATEGORIES`와 주문서 노출 대분류를 맞출 것
 */
export type EssayCategoryConfig = {
  대분류: string;
  소분류: string[];
  /** 시드·자동 보충 시 지문당 가격(원). 없으면 price 필드를 넣지 않음(관리자 설정 유지). */
  pricePerPassage?: number;
};

/**
 * ExamData.meta.examType 식별값 — "글의 의미(함의) 서술형".
 * 이 값이 들어 있으면 검증·HTML·난이도 부록·UI 가 글의의미 전용 분기를 탄다.
 * 값이 없으면(undefined) 기존 배열형으로 동작(하위호환).
 *
 * 이 모듈은 node/브라우저 의존이 전혀 없어 lib(server)·page(client) 양쪽에서
 * 안전하게 import 할 수 있으므로 단일 소스로 둔다.
 */
export const ESSAY_MEANING_EXAM_TYPE = '글의의미서술형';

export const ESSAY_CATEGORIES: EssayCategoryConfig[] = [
  {
    대분류: '빈칸재배열형',
    소분류: ['빈칸 재배열'],
  },
  {
    대분류: '이중요지요약형',
    소분류: ['이중요지 요약'],
    pricePerPassage: 700,
  },
  {
    대분류: '요약문조건영작형',
    소분류: ['요약문 조건 영작'],
    pricePerPassage: 200,
  },
  {
    대분류: ESSAY_MEANING_EXAM_TYPE,
    소분류: ['밑줄 의미 서술·영작'],
    pricePerPassage: 400,
  },
];

/** 서술형 주문서에 노출하는 대분류 */
export const ESSAY_ORDER_VISIBLE_MAIN_CATEGORIES = ESSAY_CATEGORIES.map((c) => c.대분류);
