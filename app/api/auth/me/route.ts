import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME, comparePassword, DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { buildAuthUserPayload } from '@/lib/auth-user-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 세션 상태는 절대 캐시되면 안 됨 (CDN·브라우저 캐시로 인한 간헐 로그인 풀림 방지) */
const NO_STORE = { headers: { 'Cache-Control': 'private, no-store, max-age=0' } } as const;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 200, ...NO_STORE });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 200, ...NO_STORE });
  }
  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      {
        projection: {
          loginId: 1,
          role: 1,
          name: 1,
          email: 1,
          dropboxFolderPath: 1,
          dropboxSharedLink: 1,
          canAccessAnalysis: 1,
          canAccessEssay: 1,
          canOrderSchoolTextbook: 1,
          myFormatApproved: 1,
          allowedTextbooks: 1,
          allowedTextbooksAnalysis: 1,
          allowedTextbooksEssay: 1,
          allowedTextbooksWorkbook: 1,
          allowedTextbooksVariant: 1,
          points: 1,
          annualMemberSince: 1,
          monthlyMemberSince: 1,
          monthlyMemberUntil: 1,
          signupPremiumTrialUntil: 1,
          phone: 1,
          isVip: 1,
          vipSince: 1,
          passwordHash: 1,
          createdAt: 1,
        },
      }
    );
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    // 초기 비밀번호 여부(mustChangePassword) 판정은 bcrypt 비교라 비싸다(순수 JS bcryptjs).
    // AppBar 등 거의 모든 페이지가 매 로드마다 부르는 이 엔드포인트의 핫패스에서 매번 돌리면
    // 세션 확인이 수백 ms~초 단위로 느려진다. 실제로 이 값이 필요한 화면(마이페이지)만
    // ?pwcheck=1 로 요청하고, 그 외에는 계산하지 않는다(= false).
    const wantPwCheck = request.nextUrl.searchParams.get('pwcheck') === '1';
    const passwordHash = (user as { passwordHash?: string }).passwordHash;
    const mustChangePassword =
      wantPwCheck &&
      user.role === 'user' &&
      typeof passwordHash === 'string' &&
      (await comparePassword(DEFAULT_MEMBER_INITIAL_PASSWORD, passwordHash));
    return NextResponse.json(
      { user: buildAuthUserPayload(user as unknown as Record<string, unknown>, mustChangePassword) },
      NO_STORE,
    );
  } catch {
    return NextResponse.json({
      user: {
        loginId: payload.loginId,
        role: payload.role,
        name: payload.loginId,
        email: '',
        canAccessAnalysis: false,
        canAccessEssay: false,
        canOrderSchoolTextbook: false,
        myFormatApproved: false,
        allowedTextbooks: [],
        allowedTextbooksAnalysis: [],
        allowedTextbooksEssay: [],
        points: 0,
        annualMemberSince: null,
        isAnnualMemberActive: false,
        monthlyMemberSince: null,
        monthlyMemberUntil: null,
        isMonthlyMemberActive: false,
        isPremiumMember: false,
        signupPremiumTrialUntil: null,
        signupPremiumTrialActive: false,
        phone: '',
        isVip: false,
        vipSince: null,
        mustChangePassword: false,
        variantTrial: null,
      },
    }, NO_STORE);
  }
}
