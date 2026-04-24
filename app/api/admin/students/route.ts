import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const search = sp.get('search') || '';
  const sortBy = sp.get('sort') || 'createdAt';
  const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 100);

  const filter: Record<string, unknown> = { role: 'student' };
  if (search) {
    filter.$or = [
      { loginId: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
    ];
  }

  const sortMap: Record<string, [string, 1 | -1]> = {
    createdAt: ['createdAt', -1],
    lastPracticeAt: ['studentMeta.lastPracticeAt', -1],
    totalAttempts: ['studentMeta.totalAttempts', -1],
  };
  const sortObj = sortMap[sortBy] ?? (['createdAt', -1] as [string, 1 | -1]);

  const db = await getDb('gomijoshua');
  const users = await db
    .collection('users')
    .find(filter, { projection: { passwordHash: 0 } })
    .sort(sortObj)
    .limit(limit)
    .toArray();

  // 활성 enrollment 조인
  const loginIds = users.map((u) => u.loginId as string);
  const activeEnrollments = await db
    .collection('enrollments')
    .find({ studentLoginId: { $in: loginIds }, status: { $in: ['active', 'pending_payment'] } })
    .toArray();
  const enrollMap = Object.fromEntries(
    activeEnrollments.map((e) => [e.studentLoginId as string, e])
  );

  const students = users.map((u) => {
    const meta = (u.studentMeta as Record<string, unknown>) ?? {};
    const totalAttempts = (meta.totalAttempts as number) ?? 0;
    const correctAttempts = (meta.correctAttempts as number) ?? 0;
    const activeEnrollment = enrollMap[u.loginId as string];
    return {
      loginId: u.loginId,
      name: u.name ?? u.loginId,
      grade: meta.grade,
      createdAt: u.createdAt,
      lastPracticeAt: meta.lastPracticeAt,
      totalAttempts,
      correctAttempts,
      correctRate: totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : null,
      activeEnrollmentTitle: activeEnrollment?.cycleSnapshot?.title ?? null,
      activeEnrollmentStatus: activeEnrollment?.status ?? null,
    };
  });

  return NextResponse.json({ students });
}
