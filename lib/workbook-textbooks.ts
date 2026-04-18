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

import { isMockExamTextbookKey } from './mock-exam-key';

/** 모의고사 워크북용 키(옛 표기 + 신표기 모두 인식) */
export function isWorkbookMockExamTextbookKey(key: string): boolean {
  return isMockExamTextbookKey(key);
}

/**
 * 워크북 교재 선택 화면의 **부교재** 목록만 계산합니다. 모의고사 키는 제외합니다.
 * - **비회원**: `defaultTextbooksForGuests`(관리자 기본 노출)만 노출. 미설정/빈 배열이면 [].
 * - 회원 `allowedTextbooksWorkbook` 미설정: `allowedTextbooks` 또는 공통만
 * - 회원 `allowedTextbooksWorkbook` 설정: 공통 ∪ 개인 목록
 */
export function filterWorkbookSupplementaryTextbookKeys(
  allKeys: string[],
  opts: {
    allowedTextbooks?: string[] | undefined;
    allowedTextbooksWorkbook?: string[] | undefined;
    /** 비회원 전용. 관리자 '기본 노출 교재' 목록. 비회원이면 이 목록만 보임 */
    defaultTextbooksForGuests?: string[] | undefined;
    /** 비회원 여부. true이면 defaultTextbooksForGuests만 적용 */
    isGuest?: boolean;
  }
): string[] {
  const suppKeys = allKeys.filter((k) => !isWorkbookMockExamTextbookKey(k));
  const common = new Set(WORKBOOK_SUPPLEMENTARY_COMMON_KEYS);

  if (opts.isGuest) {
    const guestList = opts.defaultTextbooksForGuests;
    if (!guestList || guestList.length === 0) return [];
    const set = new Set(guestList);
    return suppKeys.filter((k) => set.has(k));
  }

  const personal = opts.allowedTextbooksWorkbook;
  if (personal === undefined) {
    const allowed = opts.allowedTextbooks;
    if (allowed === undefined || allowed.length === 0) {
      const onlyCommon = suppKeys.filter((k) => common.has(k));
      if (onlyCommon.length === 0) return suppKeys;
      return onlyCommon;
    }
    return filterSupplementaryByAllowed(suppKeys, allowed);
  }
  const allow = new Set<string>([...common, ...personal]);
  return suppKeys.filter((k) => allow.has(k));
}
