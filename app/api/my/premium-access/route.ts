import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isPremiumMember } from '@/lib/premium-member';

/**
 * 프리미엄(연회원·월구독·관리자) 여부만 가볍게 조회.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ ok: true, loggedIn: false, isPremiumMember: false });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: true, loggedIn: false, isPremiumMember: false });
  }
  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { role: 1, annualMemberSince: 1, monthlyMemberUntil: 1 } },
    );
    if (!user) {
      return NextResponse.json({ ok: true, loggedIn: false, isPremiumMember: false });
    }
    const premium = isPremiumMember({
      role: user.role,
      annualSince: (user as { annualMemberSince?: Date }).annualMemberSince ?? null,
      monthlyUntil: (user as { monthlyMemberUntil?: Date }).monthlyMemberUntil ?? null,
    });
    return NextResponse.json({
      ok: true,
      loggedIn: true,
      isPremiumMember: premium,
    });
  } catch {
    return NextResponse.json({ ok: false, error: '조회 실패' }, { status: 500 });
  }
}
