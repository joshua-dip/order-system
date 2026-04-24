import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

export type StudentPayload = { sub: string; loginId: string; role: string };

export async function requireStudent(
  request: NextRequest
): Promise<{ error: NextResponse | null; payload: StudentPayload | null }> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  }
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'student') {
    return { error: NextResponse.json({ error: '학생 계정만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload: payload as StudentPayload };
}
