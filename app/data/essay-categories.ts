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
];

/** 서술형 주문서에 노출하는 대분류 */
export const ESSAY_ORDER_VISIBLE_MAIN_CATEGORIES = ESSAY_CATEGORIES.map((c) => c.대분류);
