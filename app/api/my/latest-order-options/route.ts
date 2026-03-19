import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

const FLOWS = ['mockVariant', 'bookVariant', 'numberBased', 'workbook'] as const;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload?.loginId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const flow = request.nextUrl.searchParams.get('flow') || '';
  if (!FLOWS.includes(flow as (typeof FLOWS)[number])) {
    return NextResponse.json({ error: 'flow 파라미터가 필요합니다. (mockVariant|bookVariant|numberBased|workbook)' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db
      .collection('orders')
      .findOne(
        { loginId: payload.loginId, 'orderMeta.flow': flow },
        { sort: { createdAt: -1 }, projection: { orderMeta: 1, createdAt: 1, orderNumber: 1 } }
      );
    if (!doc?.orderMeta || typeof doc.orderMeta !== 'object') {
      return NextResponse.json({ orderMeta: null });
    }
    return NextResponse.json({
      orderMeta: doc.orderMeta,
      savedAt: doc.createdAt,
      orderNumber: doc.orderNumber ?? null,
    });
  } catch (e) {
    console.error('latest-order-options:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
