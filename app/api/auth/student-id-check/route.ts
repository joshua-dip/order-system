import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const loginId = typeof body.loginId === 'string' ? body.loginId.trim() : '';
  if (!loginId || loginId.length < 4 || loginId.length > 20 || !/^[a-zA-Z0-9]+$/.test(loginId)) {
    return NextResponse.json({ available: false, error: '아이디는 영문+숫자 4-20자여야 합니다.' });
  }

  const db = await getDb('gomijoshua');
  const existing = await db.collection('users').findOne({ loginId });
  if (existing) {
    return NextResponse.json({ available: false, error: '이미 사용 중인 아이디입니다.' });
  }
  return NextResponse.json({ available: true });
}
