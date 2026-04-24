import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireStudent } from '@/lib/student-auth';
import { ENROLLMENTS_COLLECTION } from '@/lib/enrollments-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const doc = await db
    .collection(ENROLLMENTS_COLLECTION)
    .findOne({ _id: new ObjectId(id), studentLoginId: payload!.loginId });

  if (!doc) return NextResponse.json({ error: '등록 정보를 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({
    id: (doc._id as ObjectId).toString(),
    cycleId: doc.cycleId.toString(),
    cycleSnapshot: doc.cycleSnapshot,
    status: doc.status,
    depositorName: doc.depositorName,
    appliedAt: doc.appliedAt,
    paidAt: doc.paidAt,
    activatedAt: doc.activatedAt,
    adminMemo: doc.adminMemo,
    currentWeek: doc.currentWeek,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const doc = await db
    .collection(ENROLLMENTS_COLLECTION)
    .findOne({ _id: new ObjectId(id), studentLoginId: payload!.loginId });

  if (!doc) return NextResponse.json({ error: '등록 정보를 찾을 수 없습니다.' }, { status: 404 });
  if (doc.status !== 'pending_payment') {
    return NextResponse.json({ error: '결제 대기 상태에서만 수정 가능합니다.' }, { status: 409 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.depositorName === 'string') $set.depositorName = body.depositorName.trim();
  if (body.markPaid === true) $set.paidAt = new Date();

  await db.collection(ENROLLMENTS_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set });
  return NextResponse.json({ ok: true });
}
