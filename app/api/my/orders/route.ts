import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isMemberCancellableOrder } from '@/lib/order-cancellable';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ orders: [] }, { status: 200 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ orders: [] }, { status: 200 });
  }

  try {
    const db = await getDb('gomijoshua');
    const orders = await db
      .collection('orders')
      .find({ loginId: payload.loginId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const list = orders.map((o) => ({
      id: o._id.toString(),
      orderText: o.orderText,
      createdAt: o.createdAt,
      status: o.status || 'pending',
      orderNumber: o.orderNumber ?? null,
      fileUrl: o.fileUrl ?? null,
      /* 포인트로 결제한 주문임을 회원도 확인할 수 있어야 한다 —
         관리자가 대신 처리한 건도 여기에 그대로 나타난다. */
      pointsUsed: typeof o.pointsUsed === 'number' && o.pointsUsed > 0 ? o.pointsUsed : 0,
      /* 취소 버튼을 띄울지는 서버가 정한다 — 화면에서 상태 문자열로 다시 판단하면
         0원 자동확인 같은 예외가 생길 때마다 두 곳이 어긋난다. */
      cancellable: isMemberCancellableOrder(o),
    }));

    return NextResponse.json({ orders: list });
  } catch (err) {
    console.error('내 주문 조회 실패:', err);
    return NextResponse.json({ orders: [] }, { status: 200 });
  }
}
