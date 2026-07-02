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

/** 결제 가능한 멤버십 플랜 */
export type MembershipPlan = 'monthly' | 'annual';

export const MEMBERSHIP_MONTHLY_ORDER_NAME = '월회원 (1개월)';
export const MEMBERSHIP_ANNUAL_ORDER_NAME = '연회원 (12개월)';

/** 플랜별 결제 금액(원) */
export function membershipAmountWon(plan: MembershipPlan): number {
  return plan === 'annual' ? MEMBERSHIP_ANNUAL_REFERENCE_WON : MEMBERSHIP_MONTHLY_WON;
}

/** 플랜별 토스 주문명 */
export function membershipOrderName(plan: MembershipPlan): string {
  return plan === 'annual' ? MEMBERSHIP_ANNUAL_ORDER_NAME : MEMBERSHIP_MONTHLY_ORDER_NAME;
}
