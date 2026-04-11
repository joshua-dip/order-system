import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipStudentScore } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const schoolExamId = sp.get('schoolExamId');
  if (!schoolExamId) return NextResponse.json({ error: 'schoolExamId가 필요합니다.' }, { status: 400 });

  const scores = await col<VipStudentScore>(db, 'studentScores')
    .find({ userId: uid, schoolExamId: new ObjectId(schoolExamId) })
    .toArray();

  return NextResponse.json({
    ok: true,
    scores: scores.map((s) => ({
      id: s._id!.toString(),
      studentId: s.studentId.toString(),
      schoolExamId: s.schoolExamId.toString(),
      answers: s.answers ?? {},
      objectiveScore: s.objectiveScore ?? 0,
      subjectiveScore: s.subjectiveScore ?? 0,
      totalScore: s.totalScore ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const items = Array.isArray(body) ? body : [body];
  const results = [];

  for (const item of items) {
    if (!item.studentId || !item.schoolExamId) continue;

    const studentId = new ObjectId(item.studentId);
    const schoolExamId = new ObjectId(item.schoolExamId);

    const $set: Record<string, unknown> = {
      userId: uid,
      studentId,
      schoolExamId,
      updatedAt: new Date(),
    };
    if (item.answers !== undefined) $set.answers = item.answers;
    if (item.objectiveScore !== undefined) $set.objectiveScore = Number(item.objectiveScore);
    if (item.subjectiveScore !== undefined) $set.subjectiveScore = Number(item.subjectiveScore);
    if (item.totalScore !== undefined) $set.totalScore = Number(item.totalScore);

    const result = await col<VipStudentScore>(db, 'studentScores').updateOne(
      { studentId, schoolExamId },
      { $set, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    results.push({ studentId: item.studentId, upserted: !!result.upsertedId });
  }

  return NextResponse.json({ ok: true, results });
}
