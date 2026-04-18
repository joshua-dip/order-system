/**
 * 부교재 변형문제 주문(/textbook) 교재 선택 화면용.
 * 워크북 부교재와 동일하게: 공통 키 ∪ 회원 전용 목록.
 */

import { isMockExamTextbookKey } from './mock-exam-key';

/** 모의고사용 키(고1_/고2_/고3_ 옛 표기 + "YY년 M월 고N 영어모의고사" 신표기) — 변형 부교재 목록에서 제외 */
export function isVariantMockExamTextbookKey(key: string): boolean {
  return isMockExamTextbookKey(key);
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
 * 변환 JSON(`allKeys`)에 아직 없어도 허용 목록에만 있으면 맨 뒤에 붙여 반환합니다.
 */
export function filterVariantSupplementaryTextbookKeys(
  allKeys: string[],
  opts: { allowedTextbooksVariant: string[] }
): string[] {
  const suppKeys = allKeys.filter((k) => !isVariantMockExamTextbookKey(k));
  const common = new Set(VARIANT_SUPPLEMENTARY_COMMON_KEYS);
  const allow = new Set<string>([...common, ...opts.allowedTextbooksVariant]);
  const fromData = suppKeys.filter((k) => allow.has(k));
  /** 허용 집합에는 있으나 아직 변환 JSON 키에 없는 교재(회원 전용 선행 등록 등) — 모의고사 키만 제외 */
  const allowOnlyKeys = [...new Set([...opts.allowedTextbooksVariant, ...VARIANT_SUPPLEMENTARY_COMMON_KEYS])].filter(
    (k): k is string =>
      typeof k === 'string' &&
      k.trim() !== '' &&
      !isVariantMockExamTextbookKey(k) &&
      allow.has(k) &&
      !fromData.includes(k),
  );
  return [...fromData, ...allowOnlyKeys];
}
