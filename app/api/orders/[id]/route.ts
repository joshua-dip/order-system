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

    if (body?.action === 'setStatus' && isAdmin) {
      const allowed = ['pending', 'accepted', 'payment_confirmed', 'in_progress', 'completed', 'cancelled'];
      const newStatus = body?.status;
      if (!newStatus || !allowed.includes(newStatus)) {
        return NextResponse.json({ error: '유효한 상태가 아닙니다.' }, { status: 400 });
      }
      const db = await getDb('gomijoshua');
      await db.collection(COLLECTION).updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: newStatus } }
      );
      return NextResponse.json({ ok: true });
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
    const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('주문 삭제 실패:', err);
    return NextResponse.json({ error: '주문 삭제에 실패했습니다.' }, { status: 500 });
  }
}
