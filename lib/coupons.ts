/**
 * 포인트 충전 할인 쿠폰.
 *
 * - 관리자가 특정 회원에게 10% / 30% / 50% 할인 쿠폰을 수동 지급.
 * - 회원이 포인트 충전 시 보유 쿠폰 1장을 사용하면 결제 금액이 할인됨 (같은 포인트를 더 싸게).
 * - 패키지 기본 할인(5/10/15%) 과는 중첩하지 않고, 더 큰 할인율만 적용.
 * - 결제 성공 시 쿠폰은 used 로 소진.
 */

import type { Db, ObjectId } from 'mongodb';
import { ObjectId as Oid } from 'mongodb';
import type { CouponDiscountPct, CouponStatus, CouponView } from './coupons-shared';

// 공용(순수) 타입·헬퍼 재노출 — 서버에서 한 곳에서 import 하도록.
export type { CouponDiscountPct, CouponStatus, CouponView } from './coupons-shared';
export { VALID_COUPON_PCTS, isValidCouponPct, effectivePointChargeDiscount } from './coupons-shared';

export const COUPONS_COLLECTION = 'coupons';

export interface CouponDoc {
  _id: ObjectId;
  userId: ObjectId;
  discountPct: CouponDiscountPct;
  status: CouponStatus;
  issuedAt: Date;
  /** 발급한 관리자 loginId */
  issuedBy: string;
  note?: string;
  usedAt?: Date;
  /** 사용된 point_charge_orders.orderId */
  usedOrderId?: string;
  revokedAt?: Date;
}

export function toCouponView(d: CouponDoc): CouponView {
  return {
    id: String(d._id),
    discountPct: d.discountPct,
    status: d.status,
    issuedAt: d.issuedAt ? new Date(d.issuedAt).toISOString() : '',
    issuedBy: d.issuedBy,
    note: d.note,
    usedAt: d.usedAt ? new Date(d.usedAt).toISOString() : undefined,
    usedOrderId: d.usedOrderId,
  };
}

// ── 스토어 함수 ──────────────────────────────────────────────────────────────

export async function ensureCouponIndexes(db: Db): Promise<void> {
  await db.collection(COUPONS_COLLECTION).createIndex({ userId: 1, status: 1 }).catch(() => {});
}

export async function issueCoupon(
  db: Db,
  params: { userId: ObjectId; discountPct: CouponDiscountPct; issuedBy: string; note?: string },
): Promise<string> {
  const now = new Date();
  const r = await db.collection(COUPONS_COLLECTION).insertOne({
    userId: params.userId,
    discountPct: params.discountPct,
    status: 'active',
    issuedAt: now,
    issuedBy: params.issuedBy,
    ...(params.note?.trim() ? { note: params.note.trim() } : {}),
  });
  return String(r.insertedId);
}

export async function listUserCoupons(
  db: Db,
  userId: ObjectId,
  opts?: { status?: CouponStatus },
): Promise<CouponView[]> {
  const filter: Record<string, unknown> = { userId };
  if (opts?.status) filter.status = opts.status;
  const docs = await db
    .collection(COUPONS_COLLECTION)
    .find(filter)
    .sort({ status: 1, issuedAt: -1 })
    .limit(200)
    .toArray();
  return docs.map(d => toCouponView(d as unknown as CouponDoc));
}

/** 활성 쿠폰 1건 조회 (소유자 검증 포함). */
export async function getActiveCoupon(
  db: Db,
  couponId: string,
  userId: ObjectId,
): Promise<CouponDoc | null> {
  let oid: ObjectId;
  try {
    oid = new Oid(couponId);
  } catch {
    return null;
  }
  const doc = await db.collection(COUPONS_COLLECTION).findOne({ _id: oid, userId, status: 'active' });
  return (doc as unknown as CouponDoc) ?? null;
}

/**
 * 쿠폰 소진 (active → used). 동시성 안전: status='active' 조건부 업데이트.
 * 반환: 실제로 이번 호출에서 소진했으면 true, 이미 소진/없으면 false.
 */
export async function consumeCoupon(
  db: Db,
  couponId: string,
  userId: ObjectId,
  usedOrderId: string,
): Promise<boolean> {
  let oid: ObjectId;
  try {
    oid = new Oid(couponId);
  } catch {
    return false;
  }
  const r = await db.collection(COUPONS_COLLECTION).updateOne(
    { _id: oid, userId, status: 'active' },
    { $set: { status: 'used', usedAt: new Date(), usedOrderId } },
  );
  return r.modifiedCount > 0;
}

/** 활성 쿠폰 회수 (active → revoked). 관리자용. */
export async function revokeCoupon(db: Db, couponId: string): Promise<boolean> {
  let oid: ObjectId;
  try {
    oid = new Oid(couponId);
  } catch {
    return false;
  }
  const r = await db.collection(COUPONS_COLLECTION).updateOne(
    { _id: oid, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } },
  );
  return r.modifiedCount > 0;
}
