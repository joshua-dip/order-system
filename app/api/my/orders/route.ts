import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

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
    }));

    return NextResponse.json({ orders: list });
  } catch (err) {
    console.error('내 주문 조회 실패:', err);
    return NextResponse.json({ orders: [] }, { status: 200 });
  }
}
