import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { parseOrderRevenueFromOrderText, getBookVariantSolbookAccounting } from '@/lib/order-revenue';
import { recordPointLedger } from '@/lib/point-ledger';
import { tryRefundPointsAfterOrderCancelled } from '@/lib/refund-order-points-on-cancel';

const COLLECTION = 'orders';

/** 취소 가능한 상태: 관리자 수락(제작 수락) 전까지만 */
const CANCELLABLE_STATUS = 'pending';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 주문 ID입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const order = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({
      id: order._id.toString(),
      orderText: order.orderText,
      createdAt: order.createdAt,
      status: order.status || 'pending',
      orderNumber: order.orderNumber ?? null,
      fileUrl: order.fileUrl ?? null,
      loginId: order.loginId ?? null,
    });
  } catch (err) {
    console.error('주문 조회 실패:', err);
    return NextResponse.json({ error: '주문 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 주문 ID입니다.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    const adminToken = request.cookies.get(COOKIE_NAME)?.value;
    const adminPayload = adminToken ? await verifyToken(adminToken) : null;
    const isAdmin = adminPayload?.role === 'admin';

    if (body?.action === 'setFileUrl') {
      if (!isAdmin) {
        return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
      }
      const db = await getDb('gomijoshua');
      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $set: { fileUrl: body.fileUrl ?? '' } }
      );
      return NextResponse.json({ ok: true });
    }

    /**
     * 관리자가 이 주문을 회원 포인트로 결제 처리한다.
     *
     * 주문 시점에 회원이 직접 포인트를 쓰는 길(orders POST)은 있었지만, 나중에
     * 관리자가 대신 처리할 수단이 없었다 — 「포인트로 해 주세요」라는 요청이 오면
     * 회원 포인트를 손으로 깎고 주문서 금액을 따로 적어야 했다.
     *
     * 차감·원장 기록·주문 반영을 한 번에 하고, 이미 처리된 주문은 다시 깎지 않는다.
     */
    if (body?.action === 'payWithPoints' && isAdmin) {
      const db = await getDb('gomijoshua');
      const col = db.collection(COLLECTION);
      const existing = await col.findOne({ _id: new ObjectId(id) });
      if (!existing) {
        return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
      }
      /* 이메일로 추정해 붙인 회원에게는 차감하지 않는다 — 본인 확인이 된 주문만.
         (주문 생성 때와 같은 규칙) */
      const loginId = typeof existing.loginId === 'string' ? existing.loginId : '';
      if (!loginId || existing.loginIdSource === 'email-match') {
        return NextResponse.json(
          { error: '로그인으로 확인된 회원 주문만 포인트로 처리할 수 있습니다.' },
          { status: 400 },
        );
      }
      const already = typeof existing.pointsUsed === 'number' ? existing.pointsUsed : 0;
      if (already > 0) {
        return NextResponse.json(
          { error: `이미 포인트 ${already.toLocaleString()}원이 사용된 주문입니다.` },
          { status: 409 },
        );
      }

      const users = db.collection('users');
      const userDoc = await users.findOne({ loginId }, { projection: { points: 1, name: 1 } });
      if (!userDoc) {
        return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });
      }
      const balance = typeof userDoc.points === 'number' ? userDoc.points : 0;

      /* 금액: 관리자가 지정하면 그 값, 아니면 주문서에서 읽은 금액 전액. */
      const gross = parseOrderRevenueFromOrderText(
        typeof existing.orderText === 'string' ? existing.orderText : '',
        (existing as { orderMeta?: unknown }).orderMeta,
      );
      const requested = Number(body?.amount);
      const amount = Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : (gross ?? 0);
      if (amount <= 0) {
        return NextResponse.json(
          { error: '주문 금액을 읽지 못했습니다. 사용할 포인트를 직접 입력해 주세요.' },
          { status: 400 },
        );
      }
      if (amount > balance) {
        return NextResponse.json(
          { error: `보유 포인트가 부족합니다. (보유 ${balance.toLocaleString()}P · 필요 ${amount.toLocaleString()}P)` },
          { status: 400 },
        );
      }

      await users.updateOne({ _id: userDoc._id }, { $inc: { points: -amount } });
      await col.updateOne({ _id: new ObjectId(id) }, { $set: { pointsUsed: amount } });
      await recordPointLedger(db, {
        userId: userDoc._id as ObjectId,
        delta: -amount,
        balanceAfter: balance - amount,
        kind: 'order_spend',
        meta: {
          orderNumber: existing.orderNumber ?? '',
          orderId: id,
          /* 관리자가 대신 처리한 건임을 남긴다 — 회원이 직접 쓴 것과 구분된다. */
          byAdmin: adminPayload?.loginId ?? 'admin',
        },
      }).catch((e) => console.error('point_ledger 기록 실패:', e));

      return NextResponse.json({
        ok: true,
        pointsUsed: amount,
        balanceAfter: balance - amount,
        name: userDoc.name ?? loginId,
      });
    }

    if (body?.action === 'setStatus' && isAdmin) {
      const allowed = ['pending', 'accepted', 'payment_confirmed', 'in_progress', 'completed', 'cancelled', 'free_share'];
      const newStatus = body?.status;
      if (!newStatus || !allowed.includes(newStatus)) {
        return NextResponse.json({ error: '유효한 상태가 아닙니다.' }, { status: 400 });
      }
      const db = await getDb('gomijoshua');
      const col = db.collection(COLLECTION);
      const existing = await col.findOne({ _id: new ObjectId(id) });
      if (!existing) {
        return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
      }

      const now = new Date();
      let parsedRevenue: number | null = null;
      let orderGrossWon: number | null = null;
      let solbookAccountingSplit = false;
      if (newStatus === 'completed') {
        const text = typeof existing.orderText === 'string' ? existing.orderText : '';
        const om = (existing as { orderMeta?: unknown }).orderMeta;
        const gross = parseOrderRevenueFromOrderText(text, om);
        const solAcc = getBookVariantSolbookAccounting(om);
        parsedRevenue = solAcc ? solAcc.chargedCustomWon : gross;
        if (solAcc) {
          solbookAccountingSplit = true;
          orderGrossWon = gross != null && gross > 0 ? gross : null;
        }
        await col.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: newStatus, revenueWon: parsedRevenue, completedAt: now } }
        );
      } else {
        await col.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: newStatus, revenueWon: null, completedAt: null } }
        );
      }

      const prevStatus = typeof existing.status === 'string' ? existing.status : 'pending';
      if (newStatus === 'cancelled' && prevStatus !== 'cancelled') {
        await tryRefundPointsAfterOrderCancelled(db, existing);
      }

      return NextResponse.json({
        ok: true,
        revenueWon: newStatus === 'completed' ? parsedRevenue : null,
        completedAt: newStatus === 'completed' ? now.toISOString() : null,
        ...(newStatus === 'completed' && solbookAccountingSplit
          ? { orderGrossWon, solbookAccountingSplit: true }
          : {}),
      });
    }

    if (body?.action === 'assignMember' && isAdmin) {
      const assignLoginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
      if (!assignLoginId) {
        return NextResponse.json({ error: '연결할 회원 아이디를 선택해주세요.' }, { status: 400 });
      }
      const db = await getDb('gomijoshua');
      const user = await db.collection('users').findOne({ loginId: assignLoginId, role: 'user' });
      if (!user) {
        return NextResponse.json({ error: '일반 회원만 연결할 수 있습니다.' }, { status: 400 });
      }
      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $set: { loginId: assignLoginId } }
      );
      return NextResponse.json({ ok: true });
    }

    if (body?.action !== 'cancel') {
      return NextResponse.json({ error: 'action이 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const collection = db.collection(COLLECTION);
    const order = await collection.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const status = order.status || 'pending';
    if (status !== CANCELLABLE_STATUS) {
      return NextResponse.json(
        { error: '관리자 수락 이후에는 주문 취소가 불가능합니다.' },
        { status: 403 }
      );
    }

    const token = request.cookies.get(COOKIE_NAME)?.value;
    const orderLoginId = order.loginId ?? null;
    if (orderLoginId) {
      const payload = token ? await verifyToken(token) : null;
      if (!payload || payload.loginId !== orderLoginId) {
        return NextResponse.json({ error: '본인 주문만 취소할 수 있습니다.' }, { status: 403 });
      }
    }

    const cancelRes = await collection.updateOne(
      { _id: new ObjectId(id), status: 'pending' },
      { $set: { status: 'cancelled' } }
    );
    if (cancelRes.matchedCount === 0) {
      const again = await collection.findOne({ _id: new ObjectId(id) }, { projection: { status: 1 } });
      if (!again) {
        return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
      }
      if ((again.status || 'pending') === 'cancelled') {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json(
        { error: '관리자 수락 이후에는 주문 취소가 불가능합니다.' },
        { status: 403 }
      );
    }

    await tryRefundPointsAfterOrderCancelled(db, order);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('주문 취소 실패:', err);
    return NextResponse.json({ error: '주문 취소에 실패했습니다.' }, { status: 500 });
  }
}

/** 관리자 전용: 주문 문서 삭제 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 주문 ID입니다.' }, { status: 400 });
    }

    const adminToken = request.cookies.get(COOKIE_NAME)?.value;
    const adminPayload = adminToken ? await verifyToken(adminToken) : null;
    if (adminPayload?.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection(COLLECTION);
    const existing = await col.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }
    await tryRefundPointsAfterOrderCancelled(db, existing);
    await col.deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('주문 삭제 실패:', err);
    return NextResponse.json({ error: '주문 삭제에 실패했습니다.' }, { status: 500 });
  }
}
