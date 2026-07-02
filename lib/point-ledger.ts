import type { Db, ObjectId } from 'mongodb';

export const POINT_LEDGER_COLLECTION = 'point_ledger';

/** 주문 사용 | 관리자 추가 지급 | 관리자 직접 설정(증감) | 토스 결제 포인트 충전 */
export type PointLedgerKind =
  | 'order_spend'
  | 'admin_grant'
  /** 관리자 직접 회수(차감) */
  | 'admin_recall'
  | 'admin_adjust'
  | 'point_charge'
  /** 변형문제 만들기 — 고난도 초안 생성(삽입-고난도·어법-고난도 등 차감) */
  | 'member_variant_hard'
  /** 고난도 초안 생성 실패 등으로 포인트 환급 */
  | 'member_variant_refund'
  /** 주문 취소(pending 등) 시 주문에 사용한 포인트 환급 */
  | 'order_cancel_refund'
  /** VIP 사이드바 메뉴 개별 언락(à la carte) 구매 차감 */
  | 'vip_menu_unlock'
  /** 일일 출석 보상 — 내 정보에서 하루 1회 랜덤 포인트 적립 */
  | 'attendance'
  /** 기출문제 업로드 보상 — 관리자 확인 후 1건당 지급 */
  | 'past_exam_reward';

export type PointLedgerInsert = {
  userId: ObjectId;
  /** 양수: 적립·지급, 음수: 사용·차감 */
  delta: number;
  /** 거래 직후 보유 포인트 */
  balanceAfter: number;
  kind: PointLedgerKind;
  meta?: Record<string, unknown>;
};

export async function recordPointLedger(db: Db, entry: PointLedgerInsert): Promise<void> {
  await db.collection(POINT_LEDGER_COLLECTION).insertOne({
    userId: entry.userId,
    delta: entry.delta,
    balanceAfter: entry.balanceAfter,
    kind: entry.kind,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
    createdAt: new Date(),
  });
}
