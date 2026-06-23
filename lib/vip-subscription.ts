/**
 * VIP 월 구독(수동 갱신) — 기존 토스 일회성 결제 위젯을 재사용해 매월 결제하면
 * users.vipSubscriptionUntil 을 한 달 연장한다. 활성 구독 중에는 모든 VIP 메뉴 사용.
 * (자동결제/빌링키 아님 — 매월 사용자가 직접 결제)
 */
export const VIP_SUBSCRIPTION_MONTHLY_WON = 9900;
export const VIP_SUBSCRIPTION_ORDER_NAME = 'VIP 메뉴 월 구독';

/** 활성 구독 여부 (만료일이 미래면 활성). */
export function isVipSubscriptionActive(until: Date | string | null | undefined): boolean {
  if (!until) return false;
  const d = new Date(until);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

/**
 * 한 달 연장 — 아직 유효하면 그 만료일에서 +1개월(중복결제 보호), 만료/없으면 지금부터 +1개월.
 */
export function extendOneMonth(from: Date | string | null | undefined): Date {
  const now = Date.now();
  const cur = from ? new Date(from) : null;
  const base = cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now ? cur : new Date();
  const d = new Date(base);
  d.setMonth(d.getMonth() + 1);
  return d;
}
