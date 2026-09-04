/**
 * 멤버십 결제 매출 — 관리자 매출 집계에 합산할 몫.
 *
 * 멤버십·포인트 결제는 `orders` 가 아니라 `point_charge_orders` 에 쌓여, 관리자
 * 홈 매출(orders 만 집계)에 한 번도 잡히지 않았다.
 *
 * 여기서 **멤버십만** 센다 — 포인트 충전은 그 포인트로 결제한 주문이 이미
 * orders 에 매출로 잡히므로, 충전액까지 더하면 같은 돈을 두 번 세게 된다.
 * (주문 매출은 effectiveOrderNetRevenueWon 이 포인트 사용분을 빼고 실입금만 센다.)
 */
import type { Db } from 'mongodb';
import { koreaYearMonthKey } from '@/lib/korea-date-key';
import { POINT_CHARGE_ORDERS_COLLECTION } from '@/lib/point-charge-orders';

export interface MembershipRevenueRow {
  /** 결제 시각 */
  paidAt: Date;
  /** KST 연-월 (예: '2026-09') */
  monthKey: string;
  plan: 'monthly' | 'annual';
  amountWon: number;
  userId: unknown;
}

/**
 * 결제 완료된 멤버십 건을 월 키와 함께 돌려준다.
 *
 * 주문과 달리 「완료 처리」 단계가 없다 — 결제되는 순간 이용이 시작되므로
 * status='paid' 를 그대로 확정 매출로 본다.
 */
export async function loadMembershipRevenue(db: Db): Promise<MembershipRevenueRow[]> {
  const rows = await db
    .collection(POINT_CHARGE_ORDERS_COLLECTION)
    .find({ status: 'paid', purpose: 'membership' })
    .project({ paidAt: 1, plan: 1, amountWon: 1, userId: 1 })
    .toArray();

  const out: MembershipRevenueRow[] = [];
  for (const r of rows) {
    const raw = (r as { paidAt?: unknown }).paidAt;
    const paidAt = raw instanceof Date ? raw : raw ? new Date(String(raw)) : null;
    if (!paidAt || Number.isNaN(paidAt.getTime())) continue;
    const amountWon = Number((r as { amountWon?: unknown }).amountWon);
    if (!Number.isFinite(amountWon) || amountWon <= 0) continue;
    out.push({
      paidAt,
      monthKey: koreaYearMonthKey(paidAt),
      plan: (r as { plan?: unknown }).plan === 'annual' ? 'annual' : 'monthly',
      amountWon,
      userId: (r as { userId?: unknown }).userId,
    });
  }
  return out;
}

export const MEMBERSHIP_PLAN_LABEL: Record<'monthly' | 'annual', string> = {
  monthly: '월회원',
  annual: '연회원',
};
