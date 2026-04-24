import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipSchoolExam } from '@/lib/vip-db';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json();
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.questions !== undefined) $set.questions = body.questions;
  if (body.objectiveCount !== undefined) $set.objectiveCount = Number(body.objectiveCount);
  if (body.subjectiveCount !== undefined) $set.subjectiveCount = Number(body.subjectiveCount);
  if (body.examScope !== undefined) $set.examScope = body.examScope;
  if (body.examScopePassages !== undefined) $set.examScopePassages = body.examScopePassages;
  if (body.isLocked !== undefined) $set.isLocked = !!body.isLocked;
  if (body.pdfUrl !== undefined) $set.pdfUrl = body.pdfUrl;
  if (body.pdfName !== undefined) $set.pdfName = body.pdfName;

  const result = await col<VipSchoolExam>(db, 'schoolExams').updateOne(
    { _id: new ObjectId(id), userId: uid },
    { $set },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  await col<VipSchoolExam>(db, 'schoolExams').deleteOne({ _id: new ObjectId(id), userId: uid });
  await col(db, 'studentScores').deleteMany({ schoolExamId: new ObjectId(id), userId: uid });

  return NextResponse.json({ ok: true });
}
