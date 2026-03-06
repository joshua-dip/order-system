import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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

    const db = await getDb('lyceum');
    const collection = db.collection(COLLECTION);

    const doc = {
      orderText,
      createdAt: new Date(),
      source: 'gomijoshua',
    };

    const result = await collection.insertOne(doc);

    return NextResponse.json({
      ok: true,
      id: result.insertedId.toString(),
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
