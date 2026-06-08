/**
 * 사용자 인증 헬퍼 — 로그인 여부만 검사. role 무관(admin / member 모두 허용).
 * 클래스키트 등 사용자 공개 라우트가 사용.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME, type SessionPayload } from '@/lib/auth';

export type UserPayload = SessionPayload;

export async function requireUser(
  request: NextRequest,
): Promise<{ error: NextResponse | null; payload: UserPayload | null }> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return {
      error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }),
      payload: null,
    };
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return {
      error: NextResponse.json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.' }, { status: 401 }),
      payload: null,
    };
  }
  return { error: null, payload };
}
