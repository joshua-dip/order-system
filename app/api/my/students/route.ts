import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

const COLLECTION = 'my_students';

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

/** 내 계정에 등록한 학생 목록 */
export async function GET(request: NextRequest) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(COLLECTION);
    const docs = await col
      .find({ userId })
      .sort({ createdAt: -1 })
      .project({ userId: 0 })
      .toArray();

    const students = docs.map((d) => ({
      id: d._id.toString(),
      school: String(d.school ?? ''),
      schoolId: d.schoolId ? String(d.schoolId) : undefined,
      grade: String(d.grade ?? ''),
      name: String(d.name ?? ''),
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    }));

    return NextResponse.json({ students });
  } catch (e) {
    console.error('my/students GET:', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 학생 추가 (학교 / 학년 / 이름) */
export async function POST(request: NextRequest) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  let school = typeof b.school === 'string' ? b.school.trim() : '';
  const grade = typeof b.grade === 'string' ? b.grade.trim() : '';
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const schoolIdRaw = typeof b.schoolId === 'string' ? b.schoolId.trim() : '';

  if (!grade || !name) {
    return NextResponse.json({ error: '학년, 이름을 모두 입력해 주세요.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    if (schoolIdRaw) {
      let sid: ObjectId;
      try {
        sid = new ObjectId(schoolIdRaw);
      } catch {
        return NextResponse.json({ error: '학교 선택이 올바르지 않습니다.' }, { status: 400 });
      }
      const doc = await db.collection('my_schools').findOne({ _id: sid, userId });
      if (!doc) {
        return NextResponse.json({ error: '등록된 학교를 찾을 수 없습니다. 학교 관리에서 먼저 등록해 주세요.' }, { status: 400 });
      }
      school = String(doc.name ?? '').trim();
    }
    if (!school) {
      return NextResponse.json({ error: '학교를 선택하거나 입력해 주세요.' }, { status: 400 });
    }

    const col = db.collection(COLLECTION);
    const now = new Date();
    const insert = await col.insertOne({
      userId,
      school,
      ...(schoolIdRaw ? { schoolId: new ObjectId(schoolIdRaw) } : {}),
      grade,
      name,
      createdAt: now,
    });

    return NextResponse.json({
      ok: true,
      student: {
        id: insert.insertedId.toString(),
        school,
        grade,
        name,
        createdAt: now.toISOString(),
      },
    });
  } catch (e) {
    console.error('my/students POST:', e);
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
