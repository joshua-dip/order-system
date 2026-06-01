import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { issueCoupon, ensureCouponIndexes, isValidCouponPct } from '@/lib/coupons';
import { getApplication } from '@/lib/membership-applications-store';

type Params = { params: Promise<{ id: string }> };

/**
 * 신청서의 전화번호로 만들어진 회원 계정에 포인트 충전 할인 쿠폰을 지급.
 * (계정이 이미 존재하는 경우 — 수동 완료/기존 계정 등에서 사용)
 *
 * POST { discountPct: 10 | 30 | 50 }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const discountPct =
    typeof body?.discountPct === 'number' ? body.discountPct : Number(body?.discountPct);
  if (!isValidCouponPct(discountPct)) {
    return NextResponse.json({ error: '할인율은 10·30·50 중 하나여야 합니다.' }, { status: 400 });
  }

  const app = await getApplication(id);
  if (!app) {
    return NextResponse.json({ error: '신청서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const phoneDigits = (app.phone || '').replace(/\D/g, '');
  if (!phoneDigits) {
    return NextResponse.json({ error: '신청서의 전화번호가 비어 있습니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const user = await db
      .collection('users')
      .findOne({ loginId: phoneDigits }, { projection: { _id: 1 } });
    if (!user) {
      return NextResponse.json(
        { error: '아직 계정이 없습니다. 먼저 계정을 생성하세요.' },
        { status: 404 },
      );
    }

    await ensureCouponIndexes(db);
    await issueCoupon(db, {
      userId: user._id,
      discountPct,
      issuedBy: payload?.loginId ?? 'admin',
      note: '가입 환영 쿠폰',
    });
    return NextResponse.json({ ok: true, discountPct, loginId: phoneDigits });
  } catch (e) {
    console.error('[membership grant-coupon]', e);
    return NextResponse.json({ error: '쿠폰 지급 실패' }, { status: 500 });
  }
}
