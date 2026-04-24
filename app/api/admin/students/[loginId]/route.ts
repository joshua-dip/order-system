import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { listAttempts } from '@/lib/student-attempts-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ loginId: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { loginId } = await params;
  const db = await getDb('gomijoshua');

  const user = await db
    .collection('users')
    .findOne({ loginId, role: 'student' }, { projection: { passwordHash: 0 } });
  if (!user) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const enrollments = await db
    .collection('enrollments')
    .find({ studentLoginId: loginId })
    .sort({ appliedAt: -1 })
    .toArray();

  const attempts = await listAttempts(loginId, 30);

  // AI 사용량
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  weekStart.setHours(0, 0, 0, 0);

  const aiUsageCol = db.collection('student_ai_usage');
  const [todayCount, weekCount] = await Promise.all([
    aiUsageCol.countDocuments({ studentLoginId: loginId, at: { $gte: dayStart }, ok: true }),
    aiUsageCol.countDocuments({ studentLoginId: loginId, at: { $gte: weekStart }, ok: true }),
  ]);

  const meta = (user.studentMeta as Record<string, unknown>) ?? {};
  return NextResponse.json({
    loginId: user.loginId,
    name: user.name ?? '',
    email: user.email ?? '',
    grade: meta.grade,
    subjectMemo: meta.subjectMemo ?? '',
    totalAttempts: meta.totalAttempts ?? 0,
    correctAttempts: meta.correctAttempts ?? 0,
    streak: meta.streak,
    lastPracticeAt: meta.lastPracticeAt,
    createdAt: user.createdAt,
    enrollments: enrollments.map((e) => ({
      id: e._id.toString(),
      cycleSnapshot: e.cycleSnapshot,
      status: e.status,
      appliedAt: e.appliedAt,
      activatedAt: e.activatedAt,
      adminMemo: e.adminMemo,
    })),
    attempts: attempts.map((a) => ({
      questionType: a.questionType,
      isCorrect: a.isCorrect,
      studentAnswer: a.studentAnswer,
      aiFeedback: a.aiFeedback,
      attemptAt: a.attemptAt,
    })),
    aiUsage: { today: todayCount, thisWeek: weekCount },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ loginId: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { loginId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.subjectMemo === 'string') $set['studentMeta.subjectMemo'] = body.subjectMemo;
  if (typeof body.grade === 'string') $set['studentMeta.grade'] = body.grade;

  const db = await getDb('gomijoshua');
  await db.collection('users').updateOne({ loginId, role: 'student' }, { $set });
  return NextResponse.json({ ok: true });
}
