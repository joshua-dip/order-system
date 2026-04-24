import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireStudent } from '@/lib/student-auth';

export async function GET(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const user = await db
    .collection('users')
    .findOne({ loginId: payload!.loginId, role: 'student' }, { projection: { passwordHash: 0 } });

  if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({
    loginId: user.loginId,
    name: user.name ?? '',
    email: user.email ?? '',
    studentMeta: user.studentMeta ?? {},
    createdAt: user.createdAt,
  });
}

export async function PATCH(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === 'string' && body.name.trim()) $set.name = body.name.trim();
  if (typeof body.email === 'string') $set.email = body.email.trim();
  if (typeof body.grade === 'string') $set['studentMeta.grade'] = body.grade.trim();

  const db = await getDb('gomijoshua');
  await db.collection('users').updateOne({ loginId: payload!.loginId, role: 'student' }, { $set });

  return NextResponse.json({ ok: true });
}
