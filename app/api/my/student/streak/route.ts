import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireStudent } from '@/lib/student-auth';
import { bumpStreak } from '@/lib/student-streak';

export async function POST(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne({ loginId: payload!.loginId, role: 'student' });
  if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

  const prevStreak = user.studentMeta?.streak as { count: number; lastVisitedAt: Date } | undefined;
  const newStreak = bumpStreak(prevStreak);

  if (prevStreak && newStreak === prevStreak) {
    // 같은 날 — 변경 없음
    return NextResponse.json({ streak: newStreak.count, changed: false });
  }

  await db.collection('users').updateOne(
    { loginId: payload!.loginId },
    { $set: { 'studentMeta.streak': newStreak, updatedAt: new Date() } }
  );

  return NextResponse.json({ streak: newStreak.count, changed: true });
}
