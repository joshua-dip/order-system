import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { listUserCoupons } from '@/lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — 로그인 회원의 활성 쿠폰 목록 (포인트 충전 시 사용 가능). */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let userId: ObjectId;
  try {
    userId = new ObjectId(payload.sub);
  } catch {
    return NextResponse.json({ error: '잘못된 계정입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const coupons = await listUserCoupons(db, userId, { status: 'active' });
    return NextResponse.json({ ok: true, coupons });
  } catch (e) {
    console.error('[my/coupons GET]', e);
    return NextResponse.json({ error: '쿠폰 조회 실패' }, { status: 500 });
  }
}
