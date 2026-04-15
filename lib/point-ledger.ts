import type { Db, ObjectId } from 'mongodb';

export const POINT_LEDGER_COLLECTION = 'point_ledger';

/** 주문 사용 | 관리자 추가 지급 | 관리자 직접 설정(증감) | 토스 결제 포인트 충전 */
export type PointLedgerKind =
  | 'order_spend'
  | 'admin_grant'
  | 'admin_adjust'
  | 'point_charge'
  /** 변형문제 만들기 — 삽입-고난도 초안 생성 */
  | 'member_variant_hard';

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
