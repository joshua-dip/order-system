/**
 * 서술형 워크북(이미 제작된 조건영작배열·글의의미서술형 자료) 판매가.
 *
 *  · 번호(지문) 1개 = 4난도(기본·중·고·최고) PDF 한 묶음 = 800원 (지문당 정가, 볼륨 할인 없음)
 *  · 무료 체험 없음 — 전 지문 유료 (2026-09-02 폐지. 되살리지 말 것)
 *
 * 서술형 "문제 주문"(/essay)은 지문마다 새로 제작하는 주문이라 단가 체계가 다르다(유형별 지문당 가격, 관리자 설정).
 * 이쪽은 정해진 양식의 자료를 지문 단위로 파는 것이라 별도 단가를 쓴다.
 * 전달은 **즉시 다운로드가 아니다** — 주문(BS-)이 접수되면 관리자가 확인한 뒤 PDF 를 보낸다
 * (재고가 있어도 자동 발송 경로가 없다). 화면 문구도 「주문하기 / 접수 후 확인하여 PDF 발송」으로 맞춘다.
 */

/** 지문(번호) 1개 — 4난도 전부 포함 */
export const ESSAY_WORKBOOK_PRICE_PER_SOURCE = 800;

export interface EssayWorkbookQuote {
  /** 유료로 계산되는 지문 수 — 무료 체험이 없으므로 담은 지문 수와 같다 */
  paidCount: number;
  /** 무료 체험 폐지 — 항상 0. (기존 호출부 호환을 위해 필드는 유지) */
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
 * @param _alreadyOwnedFree (미사용 — 무료 체험 폐지 전 중복 무료 방지에 쓰였음. 호출부 시그니처 호환용)
 */
export function quoteEssayWorkbook(
  selectedCount: number,
  _totalInTextbook = 0,
  _alreadyOwnedFree = 0,
): EssayWorkbookQuote {
  const paidCount = Math.max(0, selectedCount);
  const basePrice = paidCount * ESSAY_WORKBOOK_PRICE_PER_SOURCE;

  // 무료 체험·볼륨 할인 모두 폐지 — 담은 지문 전부가 정가(800원).
  // 반환 구조는 기존 호출부 호환 위해 그대로 둔다.
  return {
    paidCount,
    freeCount: 0,
    basePrice,
    discountPct: 0,
    discountLabel: '',
    discountAmount: 0,
    finalPrice: basePrice,
  };
}
