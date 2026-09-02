/**
 * 서술형 워크북(이미 제작된 조건영작배열·글의의미서술형 자료) 판매가.
 *
 *  · 번호(지문) 1개 = 4난도(기본·중·고·최고) PDF 한 묶음 = 800원 (지문당 정가, 볼륨 할인 없음)
 *  · 교재별 앞 3지문은 무료 체험
 *
 * 서술형 "문제 주문"(/essay)은 새로 제작하는 주문이라 단가 체계가 다르다(400~700원/문항).
 * 이쪽은 이미 만들어 둔 자료를 PDF 로 바로 받는 것이라 별도 단가를 쓴다.
 */

/** 지문(번호) 1개 — 4난도 전부 포함 */
export const ESSAY_WORKBOOK_PRICE_PER_SOURCE = 800;

/** 교재별 무료 체험 지문 수 (앞에서부터) */
export const ESSAY_WORKBOOK_FREE_COUNT = 3;

export interface EssayWorkbookQuote {
  /** 유료로 계산되는 지문 수 (무료 체험분 제외) */
  paidCount: number;
  freeCount: number;
  basePrice: number;
  /** 볼륨 할인 폐지 — 항상 0. (기존 호출부 호환을 위해 필드는 유지) */
  discountPct: number;
  discountLabel: string;
  discountAmount: number;
  finalPrice: number;
}

/**
 * @param selectedCount 담은 지문 수
 * @param _totalInTextbook (미사용 — 볼륨 할인 폐지 전 비율 계산에 쓰였음. 호출부 시그니처 호환용)
 * @param alreadyOwnedFree 이미 무료로 받은 지문 수 (중복 무료 방지)
 */
export function quoteEssayWorkbook(
  selectedCount: number,
  _totalInTextbook = 0,
  alreadyOwnedFree = 0,
): EssayWorkbookQuote {
  const freeLeft = Math.max(0, ESSAY_WORKBOOK_FREE_COUNT - alreadyOwnedFree);
  const freeCount = Math.min(selectedCount, freeLeft);
  const paidCount = Math.max(0, selectedCount - freeCount);
  const basePrice = paidCount * ESSAY_WORKBOOK_PRICE_PER_SOURCE;

  // 볼륨 할인 폐지 — 지문당 정가(800원). 반환 구조는 기존 호출부 호환 위해 그대로 둔다.
  return {
    paidCount,
    freeCount,
    basePrice,
    discountPct: 0,
    discountLabel: '',
    discountAmount: 0,
    finalPrice: basePrice,
  };
}
