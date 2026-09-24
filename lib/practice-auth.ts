import type { NextRequest } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

/**
 * 학습실 접근 — 문항 풀기·채점은 누구나(비회원 포함, 가입 유도).
 * 해설(원래 글 흐름)·기록·오답 분석·복습은 회원(일반·관리자)만.
 */
export async function practiceViewer(request: NextRequest): Promise<{ member: boolean; loginId: string | null }> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  const member = !!payload && ['user', 'admin'].includes(payload.role);
  return { member, loginId: member ? payload!.loginId : null };
}

/** 회원 전용 API 용 — 비회원이면 null */
export async function practiceMember(request: NextRequest): Promise<{ loginId: string } | null> {
  const v = await practiceViewer(request);
  return v.member && v.loginId ? { loginId: v.loginId } : null;
}
