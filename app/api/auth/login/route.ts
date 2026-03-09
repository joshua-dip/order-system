import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { comparePassword, createToken, COOKIE_NAME } from '@/lib/auth';

export async function POST(request: NextRequest) {
  if (!process.env.MONGODB_URI) {
    console.error('로그인 실패: MONGODB_URI 환경 변수가 없습니다.');
    return NextResponse.json(
      {
        error:
          '데이터베이스 설정이 없습니다. 배포 환경에 MONGODB_URI 환경 변수를 추가한 뒤 재배포해 주세요.',
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const loginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!loginId || !password) {
      return NextResponse.json(
        { error: '아이디와 비밀번호를 입력해주세요.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne({ loginId });
    if (!user?.passwordHash) {
      return NextResponse.json(
        { error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 }
      );
    }

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 }
      );
    }

    const token = await createToken({
      sub: user._id.toString(),
      loginId: user.loginId,
      role: user.role || 'admin',
    });

    const res = NextResponse.json({ ok: true, loginId: user.loginId });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('로그인 실패:', err);

    const isDbError =
      message.includes('MONGODB_URI') ||
      message.includes('Mongo') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('connection');

    if (isDbError) {
      return NextResponse.json(
        {
          error:
            '데이터베이스에 연결할 수 없습니다. MONGODB_URI와 네트워크(방화벽·IP 허용)를 확인해 주세요.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: '로그인 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
