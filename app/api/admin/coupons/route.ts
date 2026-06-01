import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  issueCoupon,
  listUserCoupons,
  ensureCouponIndexes,
  isValidCouponPct,
} from '@/lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?userId= — 해당 회원의 쿠폰 목록 (관리자). */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const userIdRaw = request.nextUrl.searchParams.get('userId')?.trim();
  if (!userIdRaw) return NextResponse.json({ error: 'userId 가 필요합니다.' }, { status: 400 });
  let userId: ObjectId;
  try {
    userId = new ObjectId(userIdRaw);
  } catch {
    return NextResponse.json({ error: '잘못된 userId 입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const coupons = await listUserCoupons(db, userId);
    return NextResponse.json({ ok: true, coupons });
  } catch (e) {
    console.error('[admin/coupons GET]', e);
    return NextResponse.json({ error: '쿠폰 조회 실패' }, { status: 500 });
  }
}

/** POST { userId, discountPct(10|30|50), note? } — 쿠폰 지급. */
export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const userIdRaw = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const discountPct = typeof body?.discountPct === 'number' ? body.discountPct : Number(body?.discountPct);
  const note = typeof body?.note === 'string' ? body.note : undefined;

  if (!userIdRaw) return NextResponse.json({ error: 'userId 가 필요합니다.' }, { status: 400 });
  if (!isValidCouponPct(discountPct)) {
    return NextResponse.json({ error: '할인율은 10·30·50 중 하나여야 합니다.' }, { status: 400 });
  }
  let userId: ObjectId;
  try {
    userId = new ObjectId(userIdRaw);
  } catch {
    return NextResponse.json({ error: '잘못된 userId 입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    // 회원 존재 확인
    const user = await db.collection('users').findOne({ _id: userId }, { projection: { _id: 1 } });
    if (!user) return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });

    await ensureCouponIndexes(db);
    const id = await issueCoupon(db, {
      userId,
      discountPct,
      issuedBy: payload?.loginId ?? 'admin',
      note,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error('[admin/coupons POST]', e);
    return NextResponse.json({ error: '쿠폰 지급 실패' }, { status: 500 });
  }
}
