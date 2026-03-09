import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { notifySlackOrder } from '@/lib/slack';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

const COLLECTION = 'orders';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderText = typeof body?.orderText === 'string' ? body.orderText.trim() : '';

    if (!orderText) {
      return NextResponse.json(
        { error: 'orderText가 필요합니다.' },
        { status: 400 }
      );
    }

    let loginId: string | null = null;
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload) loginId = payload.loginId;
    }

    const db = await getDb('gomijoshua');
    const collection = db.collection(COLLECTION);

    const doc = {
      orderText,
      createdAt: new Date(),
      source: 'gomijoshua',
      status: 'pending',
      ...(loginId && { loginId }),
    };

    const result = await collection.insertOne(doc);
    const orderId = result.insertedId.toString();

    notifySlackOrder(orderText, orderId).catch((e) =>
      console.error('Slack 알림 실패:', e)
    );

    return NextResponse.json({
      ok: true,
      id: orderId,
    });
  } catch (err) {
    console.error('주문 저장 실패:', err);
    const message = err instanceof Error ? err.message : '';
    const isEnvMissing = message.includes('MONGODB_URI');
    return NextResponse.json(
      {
        error: isEnvMissing
          ? 'MONGODB_URI를 .env.local에 설정한 뒤 서버를 다시 실행해주세요.'
          : '주문 저장 중 오류가 발생했습니다.',
      },
      { status: isEnvMissing ? 503 : 500 }
    );
  }
}
