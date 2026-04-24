import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireStudent } from '@/lib/student-auth';
import { ENROLLMENTS_COLLECTION, type EnrollmentDoc } from '@/lib/enrollments-store';
import { getCycleById } from '@/lib/exam-cycles-store';

export async function GET(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<EnrollmentDoc>(ENROLLMENTS_COLLECTION)
    .find({ studentLoginId: payload!.loginId })
    .sort({ appliedAt: -1 })
    .toArray();

  const enrollments = docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    cycleId: d.cycleId.toString(),
    cycleSnapshot: d.cycleSnapshot,
    status: d.status,
    depositorName: d.depositorName,
    appliedAt: d.appliedAt,
    paidAt: d.paidAt,
    activatedAt: d.activatedAt,
    adminMemo: d.adminMemo,
    currentWeek: d.currentWeek,
  }));

  return NextResponse.json({ enrollments });
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const cycleId = typeof body.cycleId === 'string' ? body.cycleId.trim() : '';
  if (!cycleId || !ObjectId.isValid(cycleId)) {
    return NextResponse.json({ error: '유효한 사이클 ID가 필요합니다.' }, { status: 400 });
  }

  const cycle = await getCycleById(cycleId);
  if (!cycle || !cycle.isActive) {
    return NextResponse.json({ error: '신청 가능한 사이클이 아닙니다.' }, { status: 404 });
  }

  const db = await getDb('gomijoshua');
  const loginId = payload!.loginId;

  // 중복 신청 방지
  const existing = await db.collection(ENROLLMENTS_COLLECTION).findOne({
    studentLoginId: loginId,
    cycleId: new ObjectId(cycleId),
    status: { $in: ['pending_payment', 'active'] },
  });
  if (existing) {
    return NextResponse.json({ error: '이미 신청 중이거나 진행 중인 사이클입니다.' }, { status: 409 });
  }

  const now = new Date();
  const doc: Omit<EnrollmentDoc, '_id'> = {
    studentLoginId: loginId,
    cycleId: new ObjectId(cycleId),
    cycleSnapshot: {
      title: cycle.title,
      targetGrade: cycle.targetGrade,
      totalWeeks: cycle.totalWeeks,
      priceWon: cycle.priceWon,
    },
    status: 'pending_payment',
    paymentMethod: 'manual',
    appliedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection(ENROLLMENTS_COLLECTION).insertOne(doc as EnrollmentDoc);
  return NextResponse.json({ ok: true, enrollmentId: result.insertedId.toString() });
}
