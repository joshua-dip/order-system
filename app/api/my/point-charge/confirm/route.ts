import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { recordPointLedger } from '@/lib/point-ledger';
import { tossConfirmPayment } from '@/lib/toss-payments-server';
import { POINT_CHARGE_ORDERS_COLLECTION } from '@/lib/point-charge-orders';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(payload.sub);
  } catch {
    return NextResponse.json({ error: '잘못된 계정입니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const paymentKey = typeof body?.paymentKey === 'string' ? body.paymentKey.trim() : '';
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const amount = typeof body?.amount === 'number' ? body.amount : parseInt(String(body?.amount ?? ''), 10);
  if (!paymentKey || !orderId || !Number.isFinite(amount) || amount < 1) {
    return NextResponse.json({ error: '결제 정보가 올바르지 않습니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const col = db.collection(POINT_CHARGE_ORDERS_COLLECTION);
  const order = await col.findOne({ orderId, userId });
  if (!order) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (order.status === 'paid') {
    return NextResponse.json({ ok: true, already: true, points: order.points });
  }
  if (order.status !== 'pending') {
    return NextResponse.json({ error: '처리할 수 없는 주문 상태입니다.' }, { status: 400 });
  }
  if (typeof order.amountWon === 'number' && order.amountWon !== amount) {
    return NextResponse.json({ error: '결제 금액이 주문과 일치하지 않습니다.' }, { status: 400 });
  }

  const toss = await tossConfirmPayment({ paymentKey, orderId, amount });
  if (!toss.ok) {
    const curAfterFail = await col.findOne({ orderId, userId });
    if (curAfterFail?.status === 'paid') {
      return NextResponse.json({ ok: true, already: true, points: curAfterFail.points });
    }
    await col.updateOne({ orderId }, { $set: { status: 'failed', failMessage: toss.message, updatedAt: new Date() } });
    return NextResponse.json({ error: toss.message }, { status: toss.status });
  }

  const points = typeof order.points === 'number' && order.points > 0 ? order.points : 0;
  if (points <= 0) {
    return NextResponse.json({ error: '주문 포인트 정보가 올바르지 않습니다.' }, { status: 500 });
  }

  const markPaid = await col.updateOne(
    { orderId, userId, status: 'pending' },
    {
      $set: {
        status: 'paid',
        paymentKey,
        paidAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  if (markPaid.matchedCount === 0) {
    const cur = await col.findOne({ orderId, userId });
    if (cur?.status === 'paid') {
      return NextResponse.json({ ok: true, already: true, points: cur.points });
    }
    return NextResponse.json({ error: '주문 상태를 갱신할 수 없습니다.' }, { status: 409 });
  }

  const users = db.collection('users');
  await users.updateOne({ _id: userId }, { $inc: { points } });
  const afterDoc = await users.findOne({ _id: userId }, { projection: { points: 1 } });
  const rawPts = afterDoc != null ? (afterDoc as unknown as { points?: unknown }).points : undefined;
  const pts = typeof rawPts === 'number' ? rawPts : NaN;
  const balanceAfter = Number.isFinite(pts) && pts >= 0 ? pts : points;

  await recordPointLedger(db, {
    userId,
    delta: points,
    balanceAfter,
    kind: 'point_charge',
    meta: {
      orderId,
      paymentKey,
      amountWon: amount,
      points,
    },
  }).catch((e) => console.error('point_charge ledger:', e));

  return NextResponse.json({ ok: true, points, balanceAfter });
}
