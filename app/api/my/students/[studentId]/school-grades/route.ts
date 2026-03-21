import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { EXAM_PERIODS, SEMESTERS, isExamPeriod, type ExamPeriod, type Semester } from '@/lib/school-grade-record';

const STUDENTS = 'my_students';
const GRADES = 'student_school_grade_records';

async function getOwnerId(request: NextRequest): Promise<ObjectId | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.sub) return null;
  try {
    return new ObjectId(payload.sub);
  } catch {
    return null;
  }
}

async function assertOwnStudent(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: ObjectId,
  studentId: string
): Promise<{ ok: true; studentOid: ObjectId } | { ok: false; status: number; error: string }> {
  if (!ObjectId.isValid(studentId)) {
    return { ok: false, status: 400, error: '잘못된 학생 ID입니다.' };
  }
  const studentOid = new ObjectId(studentId);
  const doc = await db.collection(STUDENTS).findOne({ _id: studentOid, userId });
  if (!doc) {
    return { ok: false, status: 404, error: '학생을 찾을 수 없습니다.' };
  }
  return { ok: true, studentOid };
}

/** 해당 학생의 학교 성적 기록 목록 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { studentId } = await params;
  try {
    const db = await getDb('gomijoshua');
    const own = await assertOwnStudent(db, userId, studentId);
    if (!own.ok) {
      return NextResponse.json({ error: own.error }, { status: own.status });
    }

    const docs = await db
      .collection(GRADES)
      .find({ userId, studentId: own.studentOid })
      .sort({ schoolYear: -1, semester: -1, examPeriod: -1 })
      .toArray();

    const records = docs.map((d) => ({
      id: d._id.toString(),
      schoolYear: Number(d.schoolYear) || 0,
      semester: (Number(d.semester) === 2 ? 2 : 1) as Semester,
      examPeriod: (EXAM_PERIODS.includes(d.examPeriod as ExamPeriod) ? d.examPeriod : '중간고사') as ExamPeriod,
      scoreMultipleChoice: typeof d.scoreMultipleChoice === 'number' ? d.scoreMultipleChoice : 0,
      scoreEssay: typeof d.scoreEssay === 'number' ? d.scoreEssay : 0,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : '',
    }));

    return NextResponse.json({ records });
  } catch (e) {
    console.error('school-grades GET:', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 성적 추가 또는 동일 연도·학기·시험에 대해 수정(upsert) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { studentId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const schoolYear = typeof b.schoolYear === 'number' ? b.schoolYear : parseInt(String(b.schoolYear ?? ''), 10);
  const semester = Number(b.semester) === 2 ? 2 : 1;
  const examPeriodRaw = typeof b.examPeriod === 'string' ? b.examPeriod.trim() : '';
  const scoreMultipleChoice =
    typeof b.scoreMultipleChoice === 'number'
      ? b.scoreMultipleChoice
      : parseFloat(String(b.scoreMultipleChoice ?? ''));
  const scoreEssay =
    typeof b.scoreEssay === 'number' ? b.scoreEssay : parseFloat(String(b.scoreEssay ?? ''));

  if (!Number.isFinite(schoolYear) || schoolYear < 2000 || schoolYear > 2100) {
    return NextResponse.json({ error: '연도(2000~2100)를 올바르게 입력해 주세요.' }, { status: 400 });
  }
  if (!SEMESTERS.includes(semester as 1 | 2)) {
    return NextResponse.json({ error: '학기를 선택해 주세요.' }, { status: 400 });
  }
  if (!isExamPeriod(examPeriodRaw)) {
    return NextResponse.json({ error: '중간고사 또는 기말고사를 선택해 주세요.' }, { status: 400 });
  }
  if (!Number.isFinite(scoreMultipleChoice) || scoreMultipleChoice < 0 || scoreMultipleChoice > 1000) {
    return NextResponse.json({ error: '객관식 점수를 0~1000 범위로 입력해 주세요.' }, { status: 400 });
  }
  if (!Number.isFinite(scoreEssay) || scoreEssay < 0 || scoreEssay > 1000) {
    return NextResponse.json({ error: '서술형 점수를 0~1000 범위로 입력해 주세요.' }, { status: 400 });
  }

  const examPeriod = examPeriodRaw as ExamPeriod;

  try {
    const db = await getDb('gomijoshua');
    const own = await assertOwnStudent(db, userId, studentId);
    if (!own.ok) {
      return NextResponse.json({ error: own.error }, { status: own.status });
    }

    const col = db.collection(GRADES);
    const now = new Date();
    const filter = {
      userId,
      studentId: own.studentOid,
      schoolYear,
      semester,
      examPeriod,
    };

    await col.updateOne(
      filter,
      {
        $set: {
          scoreMultipleChoice: Math.round(scoreMultipleChoice * 100) / 100,
          scoreEssay: Math.round(scoreEssay * 100) / 100,
          updatedAt: now,
        },
        $setOnInsert: {
          userId,
          studentId: own.studentOid,
          schoolYear,
          semester,
          examPeriod,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const saved = await col.findOne(filter);
    if (!saved) {
      return NextResponse.json({ error: '저장 후 조회에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      record: {
        id: saved._id.toString(),
        schoolYear,
        semester,
        examPeriod,
        scoreMultipleChoice: saved.scoreMultipleChoice as number,
        scoreEssay: saved.scoreEssay as number,
        createdAt: saved.createdAt instanceof Date ? saved.createdAt.toISOString() : '',
        updatedAt: saved.updatedAt instanceof Date ? saved.updatedAt.toISOString() : '',
      },
    });
  } catch (e) {
    console.error('school-grades POST:', e);
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
