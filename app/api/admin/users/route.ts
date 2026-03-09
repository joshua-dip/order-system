import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, hashPassword, COOKIE_NAME } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const db = await getDb('gomijoshua');
    const list = await db
      .collection('users')
      .find({ role: 'user' }, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    const users = list.map((u) => ({
      id: u._id.toString(),
      loginId: u.loginId,
      name: u.name ?? u.loginId,
      email: u.email ?? '',
      createdAt: u.createdAt,
    }));

    return NextResponse.json({ users });
  } catch (err) {
    console.error('관리자 계정 목록 조회 실패:', err);
    return NextResponse.json(
      { error: '목록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const DEFAULT_PASSWORD = '123456';
    const body = await request.json();
    const loginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!loginId) {
      return NextResponse.json(
        { error: '아이디를 입력해주세요.' },
        { status: 400 }
      );
    }

    if (loginId.length < 2) {
      return NextResponse.json(
        { error: '아이디는 2자 이상으로 입력해주세요.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const users = db.collection('users');

    const existing = await users.findOne({ loginId });
    if (existing) {
      return NextResponse.json(
        { error: '이미 사용 중인 아이디입니다.' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(DEFAULT_PASSWORD);
    await users.createIndex({ loginId: 1 }, { unique: true }).catch(() => {});
    await users.insertOne({
      loginId,
      passwordHash,
      name: name || loginId,
      email: email || '',
      role: 'user',
      createdAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      message: '일반 계정이 생성되었습니다. (초기 비밀번호: 123456)',
      loginId,
      name: name || loginId,
      email: email || '',
    });
  } catch (err) {
    console.error('관리자 계정 생성 실패:', err);
    return NextResponse.json(
      { error: '계정 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
