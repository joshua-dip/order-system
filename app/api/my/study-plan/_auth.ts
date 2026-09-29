import type { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

/** 로그인 회원 — 학습 플랜은 회원 누구나(시험범위를 가진 회원이 쓴다) */
export async function studyPlanMember(request: NextRequest): Promise<{ userId: ObjectId; loginId: string } | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload?.sub || !ObjectId.isValid(payload.sub)) return null;
  return { userId: new ObjectId(payload.sub), loginId: payload.loginId };
}
