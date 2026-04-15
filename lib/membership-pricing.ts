/**
 * 사이트·안내 문구용 요금 (실제 결제는 카카오 등 오프라인 안내와 일치시키세요).
 */

/** 월구독 (1개월) */
export const MEMBERSHIP_MONTHLY_WON = 8_900;

/** 연회원 (1년, 안내용 고정가) */
export const MEMBERSHIP_ANNUAL_REFERENCE_WON = 90_000;

/** 한 줄 요약 (본문용) */
export function membershipPricingOneLiner(): string {
  const m = MEMBERSHIP_MONTHLY_WON.toLocaleString('ko-KR');
  const y = MEMBERSHIP_ANNUAL_REFERENCE_WON.toLocaleString('ko-KR');
  return `월구독 월 ${m}원 · 연회원 연 ${y}원`;
}
