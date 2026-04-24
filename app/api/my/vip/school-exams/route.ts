import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipSchoolExam } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  if (sp.get('schoolId')) filter.schoolId = new ObjectId(sp.get('schoolId')!);
  if (sp.get('academicYear')) filter.academicYear = Number(sp.get('academicYear'));
  if (sp.get('grade')) filter.grade = Number(sp.get('grade'));

  const exams = await col<VipSchoolExam>(db, 'schoolExams')
    .find(filter)
    .sort({ academicYear: -1, grade: 1, examType: 1 })
    .toArray();

  return NextResponse.json({
    ok: true,
    exams: exams.map((e) => ({
      id: e._id!.toString(),
      schoolId: e.schoolId.toString(),
      academicYear: e.academicYear,
      grade: e.grade,
      examType: e.examType,
      questions: e.questions ?? {},
      objectiveCount: e.objectiveCount ?? 0,
      subjectiveCount: e.subjectiveCount ?? 0,
      examScope: e.examScope ?? [],
      examScopePassages: e.examScopePassages ?? [],
      isLocked: !!e.isLocked,
      pdfPath: e.pdfPath ?? null,
      pdfName: e.pdfName ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { schoolId, academicYear, grade, examType } = body;
  if (!schoolId || !academicYear || !grade || !examType) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
  }

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const existing = await col<VipSchoolExam>(db, 'schoolExams').findOne({
    userId: uid, schoolId: new ObjectId(schoolId),
    academicYear: Number(academicYear), grade: Number(grade), examType,
  });
  if (existing) {
    return NextResponse.json({ error: '동일한 시험이 이미 존재합니다.' }, { status: 409 });
  }

  const doc: VipSchoolExam = {
    userId: uid,
    schoolId: new ObjectId(schoolId),
    academicYear: Number(academicYear),
    grade: Number(grade),
    examType,
    questions: {},
    objectiveCount: 0,
    subjectiveCount: 0,
    examScope: [],
    isLocked: false,
    createdAt: new Date(),
  };

  const result = await col<VipSchoolExam>(db, 'schoolExams').insertOne(doc as any);
  return NextResponse.json({ ok: true, id: result.insertedId.toString() }, { status: 201 });
}
