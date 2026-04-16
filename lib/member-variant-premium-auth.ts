import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isPremiumMember } from '@/lib/premium-member';
import { getVariantTrialInfo } from '@/lib/variant-trial';

type PremiumUser = {
  _id: ObjectId;
  role?: string;
  annualMemberSince?: Date | null;
  monthlyMemberUntil?: Date | null;
  signupPremiumTrialUntil?: Date | null;
  createdAt?: Date | null;
};

/**
 * 변형문제 회원 API 공통: 쿠키 인증 + 월구독/연회원/체험 기간 허용.
 */
export async function requirePremiumMemberVariant(
  request: NextRequest
): Promise<{ ok: true; userId: ObjectId; user: PremiumUser } | { ok: false; response: NextResponse }> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) };
  }
  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return { ok: false, response: NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 }) };
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(payload.sub);
  } catch {
    return { ok: false, response: NextResponse.json({ error: '잘못된 사용자입니다.' }, { status: 400 }) };
  }

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: userId },
    { projection: { role: 1, annualMemberSince: 1, monthlyMemberUntil: 1, signupPremiumTrialUntil: 1, createdAt: 1 } },
  );
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 }) };
  }

  const premium = isPremiumMember({
    role: user.role,
    annualSince: (user as { annualMemberSince?: Date }).annualMemberSince ?? null,
    monthlyUntil: (user as { monthlyMemberUntil?: Date }).monthlyMemberUntil ?? null,
    signupPremiumTrialUntil: (user as { signupPremiumTrialUntil?: Date }).signupPremiumTrialUntil ?? null,
  });

  if (!premium) {
    const trial = getVariantTrialInfo((user as { createdAt?: Date }).createdAt ?? null);
    if (!trial.eligible) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: '체험 기간이 만료되었습니다. 월구독 또는 연회원으로 이용해 주세요.' },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, userId, user: user as PremiumUser };
}
