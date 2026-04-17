/** MongoDB settings._id === 'variantSolbook' 에 저장되는 값 */

export const DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON = 3000;

export type VariantSolbookStored = {
  textbookKeys: string[];
  purchaseUrl: string;
  extraFeeWon: number;
  /** 쏠북 교재 본체 예상 판매가·정가 안내(주문·입금 UI에만 사용, 입금 대상 아님) */
  retailPriceGuideText: string;
};

export function normalizeVariantSolbookValue(raw: unknown): VariantSolbookStored {
  if (!raw || typeof raw !== 'object') {
    return {
      textbookKeys: [],
      purchaseUrl: '',
      extraFeeWon: DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON,
      retailPriceGuideText: '',
    };
  }
  const o = raw as Record<string, unknown>;
  const keys = Array.isArray(o.textbookKeys)
    ? o.textbookKeys.filter((k): k is string => typeof k === 'string')
    : [];
  const purchaseUrl = typeof o.purchaseUrl === 'string' ? o.purchaseUrl.trim() : '';
  const fee =
    typeof o.extraFeeWon === 'number' && Number.isFinite(o.extraFeeWon) && o.extraFeeWon >= 0
      ? Math.round(o.extraFeeWon)
      : DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON;
  const retailPriceGuideText =
    typeof o.retailPriceGuideText === 'string' ? o.retailPriceGuideText.trim() : '';
  return { textbookKeys: keys, purchaseUrl, extraFeeWon: fee, retailPriceGuideText };
}
