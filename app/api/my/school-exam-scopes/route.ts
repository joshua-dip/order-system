import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { validateExamScopeDbEntries } from '@/lib/validate-exam-scope-db-entries';

const SCHOOLS = 'my_schools';
const SCOPES = 'my_school_exam_scopes';

async function getUserId(request: NextRequest): Promise<ObjectId | null> {
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

const SEMESTERS = ['1학기', '2학기', '여름방학', '겨울방학', '수능모의', '기타'] as const;

function normalizeYear(y: string): string | null {
  const t = y.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  if (n < 2000 || n > 2100) return null;
  return t;
}

/** 전체 학기별 시험범위 슬롯 (학교명 포함) */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const schoolIdParam = request.nextUrl.searchParams.get('schoolId');
  try {
    const db = await getDb('gomijoshua');
    const filter: Record<string, unknown> = { userId };
    if (schoolIdParam) {
      try {
        filter.schoolId = new ObjectId(schoolIdParam);
      } catch {
        return NextResponse.json({ error: 'schoolId가 올바르지 않습니다.' }, { status: 400 });
      }
    }
    const scopes = await db.collection(SCOPES).find(filter).sort({ schoolYear: -1, semester: 1 }).toArray();
    const schoolIds = [...new Set(scopes.map((s) => s.schoolId).filter(Boolean))] as ObjectId[];
    const schools =
      schoolIds.length === 0
        ? []
        : await db
            .collection(SCHOOLS)
            .find({ _id: { $in: schoolIds }, userId })
            .project({ name: 1 })
            .toArray();
    const nameById = new Map(schools.map((s) => [s._id.toString(), String(s.name ?? '')]));
    const slots = scopes.map((s) => ({
      id: s._id.toString(),
      schoolId: s.schoolId?.toString?.() ?? '',
      schoolName: nameById.get(s.schoolId?.toString?.() ?? '') ?? '',
      schoolYear: String(s.schoolYear ?? ''),
      semester: String(s.semester ?? ''),
      dbEntries: s.dbEntries ?? [],
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : '',
    }));
    return NextResponse.json({ slots });
  } catch (e) {
    console.error('my/school-exam-scopes GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: {
    schoolId?: string;
    schoolYear?: string;
    semester?: string;
    dbEntries?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }
  let schoolOid: ObjectId;
  try {
    schoolOid = new ObjectId(typeof body.schoolId === 'string' ? body.schoolId : '');
  } catch {
    return NextResponse.json({ error: 'schoolId가 필요합니다.' }, { status: 400 });
  }
  const schoolYear = normalizeYear(typeof body.schoolYear === 'string' ? body.schoolYear : '');
  if (!schoolYear) return NextResponse.json({ error: '학년도(예: 2026)를 네 자리로 입력해 주세요.' }, { status: 400 });
  const semester = typeof body.semester === 'string' ? body.semester.trim() : '';
  if (!SEMESTERS.includes(semester as (typeof SEMESTERS)[number])) {
    return NextResponse.json({ error: '학기 값이 올바르지 않습니다.' }, { status: 400 });
  }
  const err = validateExamScopeDbEntries(body.dbEntries);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const school = await db.collection(SCHOOLS).findOne({ _id: schoolOid, userId });
    if (!school) return NextResponse.json({ error: '학교를 찾을 수 없습니다.' }, { status: 404 });
    const now = new Date();
    const filter = { userId, schoolId: schoolOid, schoolYear, semester };
    await db.collection(SCOPES).updateOne(
      filter,
      {
        $set: { dbEntries: body.dbEntries, updatedAt: now },
        $setOnInsert: {
          userId,
          schoolId: schoolOid,
          schoolYear,
          semester,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    const doc = await db.collection(SCOPES).findOne(filter);
    const id = doc?._id?.toString() ?? null;
    return NextResponse.json({ ok: true, id, updatedAt: now.toISOString() });
  } catch (e) {
    console.error('my/school-exam-scopes POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const r = await db.collection(SCOPES).deleteOne({ _id: oid, userId });
    if (r.deletedCount === 0) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('my/school-exam-scopes DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
