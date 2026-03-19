function filterSupplementaryByAllowed(allKeys: string[], allowed: string[] | undefined): string[] {
  if (allowed === undefined) return allKeys;
  const set = new Set(allowed);
  return allKeys.filter((k) => set.has(k));
}

/**
 * 워크북 주문 시 **모든 회원**에게 항상 노출할 부교재 키(converted_data 최상위 키와 동일).
 * 개인별 목록과 합집합으로 적용됩니다. 여기 없는 교재는 회원별 설정으로만 노출 가능합니다.
 */
export const WORKBOOK_SUPPLEMENTARY_COMMON_KEYS: string[] = [
  // 예: 'EBS 수능특강 영어독해',
];

/** 모의고사 워크북용 키(고1_/고2_/고3_ 접두) 여부 */
export function isWorkbookMockExamTextbookKey(key: string): boolean {
  return /^고[123]_/.test(key);
}

/**
 * 워크북 교재 선택 화면의 **부교재** 목록만 계산합니다. 모의고사 키는 제외합니다.
 * - `allowedTextbooksWorkbook` 미설정: 기존과 동일하게 `allowedTextbooks`로 필터
 * - 설정됨: `WORKBOOK_SUPPLEMENTARY_COMMON_KEYS` ∪ 개인 목록
 */
export function filterWorkbookSupplementaryTextbookKeys(
  allKeys: string[],
  opts: {
    allowedTextbooks?: string[] | undefined;
    allowedTextbooksWorkbook?: string[] | undefined;
  }
): string[] {
  const suppKeys = allKeys.filter((k) => !isWorkbookMockExamTextbookKey(k));
  const personal = opts.allowedTextbooksWorkbook;
  if (personal === undefined) {
    return filterSupplementaryByAllowed(suppKeys, opts.allowedTextbooks);
  }
  const common = new Set(WORKBOOK_SUPPLEMENTARY_COMMON_KEYS);
  const allow = new Set<string>([...common, ...personal]);
  return suppKeys.filter((k) => allow.has(k));
}
