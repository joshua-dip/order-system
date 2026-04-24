import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { ENROLLMENTS_COLLECTION } from '@/lib/enrollments-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') || 'pending_payment';
  const search = sp.get('search') || '';
  const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 100);

  const validStatuses = ['pending_payment', 'active', 'completed', 'cancelled', 'refunded'];
  const statusFilter = validStatuses.includes(status) ? status : 'pending_payment';

  const filter: Record<string, unknown> = { status: statusFilter };
  if (search) {
    filter.$or = [
      { studentLoginId: { $regex: search, $options: 'i' } },
      { depositorName: { $regex: search, $options: 'i' } },
    ];
  }

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(ENROLLMENTS_COLLECTION)
    .find(filter)
    .sort({ appliedAt: -1 })
    .limit(limit)
    .toArray();

  // 학생 이름 조인
  const loginIds = [...new Set(docs.map((d) => d.studentLoginId as string))];
  const users = await db
    .collection('users')
    .find({ loginId: { $in: loginIds }, role: 'student' }, { projection: { loginId: 1, name: 1 } })
    .toArray();
  const nameMap = Object.fromEntries(users.map((u) => [u.loginId, u.name ?? u.loginId]));

  const enrollments = docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    studentLoginId: d.studentLoginId,
    studentName: nameMap[d.studentLoginId as string] ?? d.studentLoginId,
    cycleId: d.cycleId?.toString(),
    cycleSnapshot: d.cycleSnapshot,
    status: d.status,
    depositorName: d.depositorName,
    appliedAt: d.appliedAt,
    paidAt: d.paidAt,
    activatedAt: d.activatedAt,
    adminMemo: d.adminMemo,
  }));

  return NextResponse.json({ enrollments });
}
