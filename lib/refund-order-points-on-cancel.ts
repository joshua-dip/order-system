import type { Db, ObjectId } from 'mongodb';
import { recordPointLedger } from '@/lib/point-ledger';

type OrderLike = {
  _id: ObjectId;
  pointsUsed?: unknown;
  loginId?: unknown;
  orderNumber?: unknown;
};

/**
 * 주문이 취소된 뒤 호출. 주문에 pointsUsed·loginId가 있으면 회원 포인트를 한 번만 되돌립니다.
 * 실패 시 로그만 남기고 예외를 던지지 않습니다(주문 취소 자체는 이미 반영된 상태).
 */
export async function tryRefundPointsAfterOrderCancelled(db: Db, order: OrderLike): Promise<void> {
  const refundPts =
    typeof order.pointsUsed === 'number' && Number.isFinite(order.pointsUsed) && order.pointsUsed > 0
      ? Math.floor(order.pointsUsed)
      : 0;
  const loginId =
    typeof order.loginId === 'string' && order.loginId.trim() ? order.loginId.trim() : null;
  if (refundPts <= 0 || !loginId) return;

  const ordersColl = db.collection('orders');
  const usersColl = db.collection('users');

  const flagRes = await ordersColl.updateOne(
    { _id: order._id, pointsRefundedOnCancel: { $ne: true }, pointsUsed: { $gt: 0 } },
    { $set: { pointsRefundedOnCancel: true } }
  );
  if (flagRes.modifiedCount === 0) return;

  let pointsCredited = false;
  try {
    const user = await usersColl.findOne({ loginId }, { projection: { points: 1 } });
    if (!user?._id) {
      await ordersColl.updateOne({ _id: order._id }, { $unset: { pointsRefundedOnCancel: '' } });
      console.error('tryRefundPointsAfterOrderCancelled: 회원 없음', loginId);
      return;
    }
    const current = typeof user.points === 'number' && user.points >= 0 ? user.points : 0;
    const balanceAfter = current + refundPts;
    await usersColl.updateOne({ _id: user._id }, { $inc: { points: refundPts } });
    pointsCredited = true;
    await recordPointLedger(db, {
      userId: user._id as ObjectId,
      delta: refundPts,
      balanceAfter,
      kind: 'order_cancel_refund',
      meta: {
        orderId: order._id.toString(),
        orderNumber: typeof order.orderNumber === 'string' ? order.orderNumber : undefined,
      },
    });
  } catch (e) {
    console.error('tryRefundPointsAfterOrderCancelled:', e);
    if (!pointsCredited) {
      await ordersColl.updateOne({ _id: order._id }, { $unset: { pointsRefundedOnCancel: '' } });
    }
  }
}
