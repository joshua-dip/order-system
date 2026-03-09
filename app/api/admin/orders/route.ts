import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const loginId = searchParams.get('loginId')?.trim() || undefined;

    const db = await getDb('gomijoshua');
    const filter = loginId ? { loginId } : {};
    const list = await db
      .collection('orders')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(loginId ? 50 : 30)
      .toArray();

    const orders = list.map((o) => ({
      id: o._id.toString(),
      orderText: o.orderText,
      createdAt: o.createdAt,
      status: o.status || 'pending',
      statusLabel: STATUS_LABELS[o.status || 'pending'] || o.status || '주문 접수',
      loginId: o.loginId ?? null,
    }));

    return NextResponse.json({ orders });
  } catch (err) {
    console.error('관리자 주문 목록 조회 실패:', err);
    return NextResponse.json(
      { error: '목록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
