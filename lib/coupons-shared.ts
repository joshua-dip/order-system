/**
 * 쿠폰 — 클라이언트·서버 공용(순수) 타입·헬퍼. mongodb 의존성 없음.
 * 서버 전용 스토어 함수는 lib/coupons.ts 참고.
 */

export type CouponDiscountPct = 10 | 30 | 50;
export const VALID_COUPON_PCTS: CouponDiscountPct[] = [10, 30, 50];

export type CouponStatus = 'active' | 'used' | 'revoked';

/** 직렬화용 (클라이언트 전달). */
export interface CouponView {
  id: string;
  discountPct: CouponDiscountPct;
  status: CouponStatus;
  issuedAt: string;
  issuedBy?: string;
  note?: string;
  usedAt?: string;
  usedOrderId?: string;
}

export function isValidCouponPct(n: unknown): n is CouponDiscountPct {
  return typeof n === 'number' && (VALID_COUPON_PCTS as number[]).includes(n);
}

/**
 * 포인트 충전 실효 할인율 — 패키지 기본 할인과 쿠폰 할인 중 더 큰 값 (중첩 없음).
 */
export function effectivePointChargeDiscount(packagePct: number, couponPct?: number | null): number {
  const c = typeof couponPct === 'number' && couponPct > 0 ? couponPct : 0;
  return Math.max(packagePct || 0, c);
}
