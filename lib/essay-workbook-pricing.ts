/**
 * 서술형 워크북(이미 제작된 조건영작배열·글의의미서술형 자료) 판매가.
 *
 * payperic.com 의 조건영작배열 판매 정책을 그대로 따른다.
 *  · 번호(지문) 1개 = 4난도(기본·중·고·최고) PDF 한 묶음 = 800원
 *  · 한 교재의 지문을 많이 담을수록 할인 (난이도별 묶음 11% / 풀세트 20%)
 *  · 교재별 앞 3지문은 무료 체험
 *
 * 서술형 "문제 주문"(/essay)은 새로 제작하는 주문이라 단가 체계가 다르다(400~700원/문항).
 * 이쪽은 이미 만들어 둔 자료를 PDF 로 바로 받는 것이라 별도 단가를 쓴다.
 */

/** 지문(번호) 1개 — 4난도 전부 포함 */
export const ESSAY_WORKBOOK_PRICE_PER_SOURCE = 800;

/** 교재별 무료 체험 지문 수 (앞에서부터) */
export const ESSAY_WORKBOOK_FREE_COUNT = 3;

/** 담은 지문 수가 그 교재 전체의 이 비율 이상이면 묶음 할인 */
export const ESSAY_WORKBOOK_BULK = [
  { minRatio: 1, discountPct: 20, label: '풀세트' },
  { minRatio: 0.5, discountPct: 11, label: '묶음' },
] as const;

export interface EssayWorkbookQuote {
  /** 유료로 계산되는 지문 수 (무료 체험분 제외) */
  paidCount: number;
  freeCount: number;
  basePrice: number;
  discountPct: number;
  discountLabel: string;
  discountAmount: number;
  finalPrice: number;
}

/**
 * @param selectedCount 담은 지문 수
 * @param totalInTextbook 그 교재의 전체 지문 수
 * @param alreadyOwnedFree 이미 무료로 받은 지문 수 (중복 무료 방지)
 */
export function quoteEssayWorkbook(
  selectedCount: number,
  totalInTextbook: number,
  alreadyOwnedFree = 0,
): EssayWorkbookQuote {
  const freeLeft = Math.max(0, ESSAY_WORKBOOK_FREE_COUNT - alreadyOwnedFree);
  const freeCount = Math.min(selectedCount, freeLeft);
  const paidCount = Math.max(0, selectedCount - freeCount);
  const basePrice = paidCount * ESSAY_WORKBOOK_PRICE_PER_SOURCE;

  const ratio = totalInTextbook > 0 ? selectedCount / totalInTextbook : 0;
  const tier = ESSAY_WORKBOOK_BULK.find((t) => ratio >= t.minRatio);
  const discountPct = tier?.discountPct ?? 0;
  const discountAmount = Math.round((basePrice * discountPct) / 100);

  return {
    paidCount,
    freeCount,
    basePrice,
    discountPct,
    discountLabel: tier?.label ?? '',
    discountAmount,
    finalPrice: basePrice - discountAmount,
  };
}
