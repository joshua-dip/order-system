import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireStudent } from '@/lib/student-auth';
import { comparePassword, hashPassword } from '@/lib/auth';

export async function PATCH(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: '새 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne({ loginId: payload!.loginId, role: 'student' });
  if (!user?.passwordHash) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

  const ok = await comparePassword(currentPassword, user.passwordHash as string);
  if (!ok) return NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 401 });

  const passwordHash = await hashPassword(newPassword);
  await db.collection('users').updateOne(
    { loginId: payload!.loginId },
    { $set: { passwordHash, updatedAt: new Date() } }
  );

  return NextResponse.json({ ok: true });
}
