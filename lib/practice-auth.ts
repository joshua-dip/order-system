import type { NextRequest } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

/** 학습실은 로그인한 회원(일반·학생·관리자)만 — 비회원이면 null */
export async function practiceMember(request: NextRequest): Promise<{ loginId: string; role: string } | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  if (!payload || !['user', 'student', 'admin'].includes(payload.role)) return null;
  return { loginId: payload.loginId, role: payload.role };
}
