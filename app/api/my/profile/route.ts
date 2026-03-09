import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, hashPassword, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

export async function PATCH(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : undefined;
    const newPassword = typeof body?.password === 'string' ? body.password : undefined;

    const db = await getDb('gomijoshua');
    const users = db.collection('users');
    const filter = { _id: new ObjectId(payload.sub) };

    const updates: Record<string, unknown> = {};
    if (email !== undefined) updates.email = email;
    if (newPassword !== undefined) {
      if (newPassword.length < 4) {
        return NextResponse.json(
          { error: '비밀번호는 4자 이상으로 입력해주세요.' },
          { status: 400 }
        );
      }
      updates.passwordHash = await hashPassword(newPassword);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
    }

    const result = await users.updateOne(filter, { $set: updates });
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('프로필 수정 실패:', err);
    return NextResponse.json(
      { error: '수정 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
