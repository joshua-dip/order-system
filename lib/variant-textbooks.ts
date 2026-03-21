/**
 * 부교재 변형문제 주문(/textbook) 교재 선택 화면용.
 * 워크북 부교재와 동일하게: 공통 키 ∪ 회원 전용 목록.
 */

/** 모의고사용 키(고1_/고2_/고3_) — 변형 부교재 목록에서 제외 */
export function isVariantMockExamTextbookKey(key: string): boolean {
  return /^고[123]_/.test(key);
}

/**
 * 모든 회원에게 항상 노출할 부교재 키(converted_data / textbooks 데이터 키와 동일).
 * 개인별 `allowedTextbooksVariant`와 합집합으로 적용됩니다.
 */
/** 관리자 '교재 노출 설정 > 부교재 주문제작 기본 노출 교재'에서 설정한 목록이 API로 내려와 공통 유형으로 표시됩니다. 비워두면 미설정 시 전체 노출. */
export const VARIANT_SUPPLEMENTARY_COMMON_KEYS: string[] = [];

/**
 * `VARIANT_SUPPLEMENTARY_COMMON_KEYS` ∪ `allowedTextbooksVariant` 에 포함된 키만 남깁니다.
 * (모의고사 키 고1_/고2_/고3_ 제외)
 */
export function filterVariantSupplementaryTextbookKeys(
  allKeys: string[],
  opts: { allowedTextbooksVariant: string[] }
): string[] {
  const suppKeys = allKeys.filter((k) => !isVariantMockExamTextbookKey(k));
  const common = new Set(VARIANT_SUPPLEMENTARY_COMMON_KEYS);
  const allow = new Set<string>([...common, ...opts.allowedTextbooksVariant]);
  return suppKeys.filter((k) => allow.has(k));
}
