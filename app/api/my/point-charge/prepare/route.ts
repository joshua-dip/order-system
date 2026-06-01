import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getPointChargePackage, type PointChargeTierId } from '@/lib/point-charge-packages';
import { POINT_CHARGE_ORDERS_COLLECTION } from '@/lib/point-charge-orders';
import { getActiveCoupon, effectivePointChargeDiscount } from '@/lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const couponId = typeof body?.couponId === 'string' ? body.couponId.trim() : '';
  const orderId = `ppt_${userId.toHexString().slice(-8)}_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const orderName = `포인트 충전 ${pkg.points.toLocaleString()}P`;

  try {
    const db = await getDb('gomijoshua');

    // 쿠폰 검증 (있을 때만). 패키지 할인과 중첩 없이 더 큰 할인율만 적용.
    let couponDiscountPct = 0;
    let appliedCouponId: string | null = null;
    if (couponId) {
      const coupon = await getActiveCoupon(db, couponId, userId);
      if (!coupon) {
        return NextResponse.json({ error: '사용할 수 없는 쿠폰입니다 (만료·사용됨·소유자 불일치).' }, { status: 400 });
      }
      couponDiscountPct = coupon.discountPct;
      appliedCouponId = couponId;
    }

    const effectiveDiscountPct = effectivePointChargeDiscount(pkg.discountPct, couponDiscountPct);
    const amountWon = Math.round((pkg.points * (100 - effectiveDiscountPct)) / 100);
    // 쿠폰이 패키지보다 할인이 크지 않으면 쿠폰을 굳이 소모하지 않음 (저장 안 함)
    const couponEffectivelyUsed = appliedCouponId != null && couponDiscountPct > pkg.discountPct;

    await db.collection(POINT_CHARGE_ORDERS_COLLECTION).insertOne({
      orderId,
      userId,
      tier: pkg.id,
      points: pkg.points,
      discountPct: effectiveDiscountPct,
      basePackageDiscountPct: pkg.discountPct,
      couponId: couponEffectivelyUsed ? appliedCouponId : null,
      couponDiscountPct: couponEffectivelyUsed ? couponDiscountPct : 0,
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
      discountPct: effectiveDiscountPct,
      basePackageDiscountPct: pkg.discountPct,
      couponApplied: couponEffectivelyUsed,
      couponDiscountPct: couponEffectivelyUsed ? couponDiscountPct : 0,
    });
  } catch (e) {
    console.error('point-charge prepare:', e);
    return NextResponse.json({ error: '주문 준비 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
