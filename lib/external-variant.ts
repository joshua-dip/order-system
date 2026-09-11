import { variantUnitPrice } from './variant-pricing';

/**
 * 외부지문 변형문제 주문 — 회원이 붙여넣은 지문(자체 지문·타 출판사 등)으로 변형문제를 만든다(/external).
 *
 * 우리 DB 교재가 아니라 재고로 다시 쓸 수 없다(가용성이 낮다). 그래서 2026-09-11 방침으로
 *  - 무료 유형(0원 7종)·멤버십 무료 문항을 적용하지 않고,
 *  - 단가는 부교재 변형 정가의 1.3배를 10원 단위로 반올림한다.
 * 지문은 주문한 회원만 쓰는 전용 교재(`외부지문_<loginId>`)로 등록한다 — 다른 회원 주문 화면엔 안 뜬다.
 * 제작 쪽(job·cc:variant pipeline)에는 부교재 변형(flow=bookVariant)과 같은 모양으로 넘기고
 * 주문번호 접두사만 XV 로 나눈다.
 */
export const EXTERNAL_TEXTBOOK_PREFIX = '외부지문_';
export const EXTERNAL_PRICE_MULTIPLIER = 1.3;

export function externalTextbookKey(loginId: string): string {
  return `${EXTERNAL_TEXTBOOK_PREFIX}${loginId}`;
}

export function isExternalTextbookKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(EXTERNAL_TEXTBOOK_PREFIX);
}

/** 정가 → 외부지문 단가. 1.3배를 10원 단위 반올림(정수 연산 — 50→70 · 80→100 · 30→40). */
export function externalizeListPrice(won: number): number {
  return Math.round((won * 13) / 100) * 10;
}

/** 외부지문 주문의 유형별 문항 단가 */
export function externalVariantUnitPrice(type: string, opts?: { withExplanation?: boolean }): number {
  return externalizeListPrice(variantUnitPrice(type, opts));
}

/** 한 번에 올릴 수 있는 지문 수·길이 */
export const EXTERNAL_PASSAGE_LIMITS = { maxPassages: 30, minChars: 80, maxChars: 5000 } as const;

/** 영어 지문인지 — 영문 글자가 한글보다 충분히 많아야 한다(주석·해석이 조금 섞인 건 허용) */
export function englishLetterRatio(s: string): number {
  const en = (s.match(/[A-Za-z]/g) || []).length;
  const ko = (s.match(/[가-힣]/g) || []).length;
  return en + ko === 0 ? 0 : en / (en + ko);
}
export const EXTERNAL_MIN_ENGLISH_RATIO = 0.6;
