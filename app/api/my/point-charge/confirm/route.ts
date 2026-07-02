import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { recordPointLedger } from '@/lib/point-ledger';
import { tossConfirmPayment } from '@/lib/toss-payments-server';
import { POINT_CHARGE_ORDERS_COLLECTION } from '@/lib/point-charge-orders';
import { consumeCoupon } from '@/lib/coupons';
import { extendOneMonth } from '@/lib/vip-subscription';

/** 기준일(또는 지금)에서 n개월 뒤 */
function addMonths(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}
/** 기준일(또는 지금)에서 n년 뒤 */
function addYears(base: Date, n: number): Date {
  const d = new Date(base);
  d.setFullYear(d.getFullYear() + n);
  return d;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 토스 승인 API + DB 반영까지 여유 */
export const maxDuration = 60;

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

  // VIP 월 구독 결제 — 포인트 대신 vipSubscriptionUntil 한 달 연장.
  if (order.purpose === 'vip_subscription') {
    const markPaid = await col.updateOne(
      { orderId, userId, status: 'pending' },
      { $set: { status: 'paid', paymentKey, paidAt: new Date(), updatedAt: new Date() } },
    );
    if (markPaid.matchedCount === 0) {
      const cur = await col.findOne({ orderId, userId });
      if (cur?.status === 'paid') return NextResponse.json({ ok: true, already: true, vipSubscription: true });
      return NextResponse.json({ error: '주문 상태를 갱신할 수 없습니다.' }, { status: 409 });
    }
    const usersCol = db.collection('users');
    const cur = await usersCol.findOne({ _id: userId }, { projection: { vipSubscriptionUntil: 1 } });
    const until = extendOneMonth((cur as { vipSubscriptionUntil?: Date } | null)?.vipSubscriptionUntil);
    await usersCol.updateOne({ _id: userId }, { $set: { vipSubscriptionUntil: until } });
    return NextResponse.json({ ok: true, vipSubscription: true, vipSubscriptionUntil: until });
  }

  // 월/연 멤버십 결제 — 포인트 대신 monthlyMemberUntil / annualMemberSince 활성화·연장.
  if (order.purpose === 'membership') {
    const markPaid = await col.updateOne(
      { orderId, userId, status: 'pending' },
      { $set: { status: 'paid', paymentKey, paidAt: new Date(), updatedAt: new Date() } },
    );
    if (markPaid.matchedCount === 0) {
      const cur = await col.findOne({ orderId, userId });
      if (cur?.status === 'paid') return NextResponse.json({ ok: true, already: true, membership: true, plan: cur.plan ?? null });
      return NextResponse.json({ error: '주문 상태를 갱신할 수 없습니다.' }, { status: 409 });
    }
    const plan = order.plan === 'annual' ? 'annual' : 'monthly';
    const usersCol = db.collection('users');
    const now = new Date();
    if (plan === 'annual') {
      // 활성 연회원이면 현재 만료일(가입일+1년)에서 +1년 스택, 아니면 지금부터.
      const cur = await usersCol.findOne({ _id: userId }, { projection: { annualMemberSince: 1 } });
      const sinceRaw = (cur as { annualMemberSince?: Date } | null)?.annualMemberSince;
      const since = sinceRaw ? new Date(sinceRaw) : null;
      const curEnd = since && !Number.isNaN(since.getTime()) ? addYears(since, 1) : null;
      const newSince = curEnd && curEnd.getTime() > now.getTime() ? curEnd : now;
      await usersCol.updateOne({ _id: userId }, { $set: { annualMemberSince: newSince } });
      return NextResponse.json({ ok: true, membership: true, plan: 'annual', validUntil: addYears(newSince, 1) });
    }
    // monthly — 활성 월회원이면 현재 만료일에서 +1개월 스택, 아니면 지금부터.
    const cur = await usersCol.findOne({ _id: userId }, { projection: { monthlyMemberUntil: 1, monthlyMemberSince: 1 } });
    const untilRaw = (cur as { monthlyMemberUntil?: Date } | null)?.monthlyMemberUntil;
    const until = untilRaw ? new Date(untilRaw) : null;
    const active = until && !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
    const base = active ? until! : now;
    const newUntil = addMonths(base, 1);
    const set: Record<string, Date> = { monthlyMemberUntil: newUntil };
    const sinceRaw = (cur as { monthlyMemberSince?: Date } | null)?.monthlyMemberSince;
    if (!active || !sinceRaw) set.monthlyMemberSince = now;
    await usersCol.updateOne({ _id: userId }, { $set: set });
    return NextResponse.json({ ok: true, membership: true, plan: 'monthly', validUntil: newUntil });
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

  // 결제에 쿠폰이 적용됐으면 소진 (active → used). 결제 성공 후이므로 실패해도 포인트는 지급.
  const couponId = typeof order.couponId === 'string' ? order.couponId : null;
  const couponDiscountPct = typeof order.couponDiscountPct === 'number' ? order.couponDiscountPct : 0;
  if (couponId) {
    const consumed = await consumeCoupon(db, couponId, userId, orderId).catch((e) => {
      console.error('coupon consume:', e);
      return false;
    });
    if (!consumed) {
      console.warn(`[point-charge confirm] coupon ${couponId} 소진 실패(이미 사용/회수) — orderId=${orderId}`);
    }
  }

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
      ...(couponId ? { couponId, couponDiscountPct } : {}),
    },
  }).catch((e) => console.error('point_charge ledger:', e));

  return NextResponse.json({ ok: true, points, balanceAfter });
}
