import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { hashPassword, createToken, COOKIE_NAME } from '@/lib/auth';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#14b8a6', '#f97316', '#84cc16',
];

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const loginId = typeof body.loginId === 'string' ? body.loginId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : undefined;
  const agreedTerms = body.agreedTerms === true;

  if (!loginId || loginId.length < 4 || loginId.length > 20 || !/^[a-zA-Z0-9]+$/.test(loginId)) {
    return NextResponse.json({ error: '아이디는 영문+숫자 4-20자여야 합니다.' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: '이름을 입력해 주세요.' }, { status: 400 });
  }
  if (!agreedTerms) {
    return NextResponse.json({ error: '개인정보 처리방침에 동의해 주세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const existing = await db.collection('users').findOne({ loginId });
  if (existing) {
    return NextResponse.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const now = new Date();

  const result = await db.collection('users').insertOne({
    loginId,
    passwordHash,
    role: 'student',
    name,
    studentMeta: {
      grade,
      avatarColor,
      streak: undefined,
      totalAttempts: 0,
      correctAttempts: 0,
      lastPracticeAt: undefined,
    },
    createdAt: now,
    updatedAt: now,
  });

  const token = await createToken({
    sub: result.insertedId.toString(),
    loginId,
    role: 'student',
  });

  const res = NextResponse.json({ ok: true, loginId, role: 'student' });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return res;
}
