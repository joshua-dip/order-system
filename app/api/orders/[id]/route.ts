import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

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

    await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'cancelled' } }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('주문 취소 실패:', err);
    return NextResponse.json({ error: '주문 취소에 실패했습니다.' }, { status: 500 });
  }
}
