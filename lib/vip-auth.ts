import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from './auth';
import { getDb } from './mongodb';

export interface VipUser {
  userId: string;
  loginId: string;
  role: string;
}

export async function requireVip(
  request: NextRequest,
): Promise<VipUser | NextResponse> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: '세션이 만료되었습니다.' }, { status: 401 });
  }

  // 관리자는 모든 VIP 기능 점검 가능 — admin 계정으로 열면 403 이 나
  // 목록이 「교재 없음」처럼 비어 보이던 혼선 방지.
  if (payload.role === 'admin') {
    return { userId: payload.sub, loginId: payload.loginId, role: payload.role };
  }

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(payload.sub) },
    { projection: { isVip: 1 } },
  );

  if (!user?.isVip) {
    return NextResponse.json({ error: 'VIP 권한이 필요합니다.' }, { status: 403 });
  }

  return { userId: payload.sub, loginId: payload.loginId, role: payload.role };
}
