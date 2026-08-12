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
  // EBS 상시 교재 — 회원 개인 목록과 무관하게 항상 노출(개인 목록에 없어도 보임).
  // 관리자 '기본 노출 교재'(비회원용)와 동일한 큐레이션. 키는 converted 최상위 키와 정확히 일치해야 한다.
  '2027수능특강 영어(2026)',
  '2027수능특강 영어독해연습(2026)',
  '수능특강 Q 미니모의고사 영어 Start',
  '수능특강 Q 미니모의고사 영어 Jump',
  '수능특강 Light 영어독해연습',
  '올림포스 영어독해 기본1(2024)',
  '올림포스 영어독해 기본2(2024)',
  '올림포스 영어독해 9대 변별유형(2026)',
  '2026 올림포스 전국연합학력평가 기출문제집 영어독해 고1',
  'ReadingPower 유형편기본',
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

  // 공통 목록은 **더하기만** 한다 — 어떤 분기에서도 기존에 보이던 교재를 빼앗지 않는다.
  // (공통을 채우면 '공통만' 보여주도록 좁히던 옛 동작은, 개인 목록이 없던 회원 34명이
  //  전체 부교재 → 공통 10개로 급감하는 회귀를 일으켜 제거함.)
  const personal = opts.allowedTextbooksWorkbook;
  if (personal === undefined) {
    const allowed = opts.allowedTextbooks;
    // 개인 목록이 전혀 없으면 종전대로 전체 노출(공통이 이를 좁히지 않음)
    if (allowed === undefined || allowed.length === 0) return suppKeys;
    return filterSupplementaryByAllowed(suppKeys, [...common, ...allowed]);
  }
  const allow = new Set<string>([...common, ...personal]);
  return suppKeys.filter((k) => allow.has(k));
}
