import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { amountWonForPackage, getPointChargePackage, type PointChargeTierId } from '@/lib/point-charge-packages';
import { POINT_CHARGE_ORDERS_COLLECTION } from '@/lib/point-charge-orders';

const VALID_TIERS: PointChargeTierId[] = ['p10k', 'p30k', 'p50k', 'p100k'];

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
  const tier = typeof body?.tier === 'string' ? body.tier.trim() : '';
  if (!VALID_TIERS.includes(tier as PointChargeTierId)) {
    return NextResponse.json({ error: '유효하지 않은 충전 상품입니다.' }, { status: 400 });
  }

  const pkg = getPointChargePackage(tier);
  if (!pkg) {
    return NextResponse.json({ error: '유효하지 않은 충전 상품입니다.' }, { status: 400 });
  }

  const amountWon = amountWonForPackage(pkg);
  const orderId = `ppt_${userId.toHexString().slice(-8)}_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const orderName = `포인트 충전 ${pkg.points.toLocaleString()}P`;

  try {
    const db = await getDb('gomijoshua');
    await db.collection(POINT_CHARGE_ORDERS_COLLECTION).insertOne({
      orderId,
      userId,
      tier: pkg.id,
      points: pkg.points,
      discountPct: pkg.discountPct,
      amountWon,
      status: 'pending',
      createdAt: new Date(),
    });
    await db.collection(POINT_CHARGE_ORDERS_COLLECTION).createIndex({ orderId: 1 }, { unique: true }).catch(() => {});

    return NextResponse.json({
      ok: true,
      orderId,
      amount: amountWon,
      orderName,
      points: pkg.points,
      discountPct: pkg.discountPct,
    });
  } catch (e) {
    console.error('point-charge prepare:', e);
    return NextResponse.json({ error: '주문 준비 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
