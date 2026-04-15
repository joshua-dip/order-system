import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

const COLLECTION = 'exam_scopes';
const MAX_PRESETS = 20;

async function getLoginId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.loginId ?? null;
}

/** 저장된 시험범위 프리셋 목록 조회 */
export async function GET(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(COLLECTION)
      .find({ loginId })
      .sort({ savedAt: -1 })
      .limit(MAX_PRESETS)
      .project({ loginId: 0 })
      .toArray();

    const presets = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name ?? '이름 없음',
      dbEntries: d.dbEntries ?? [],
      savedAt: d.savedAt,
    }));

    return NextResponse.json({ presets });
  } catch (e) {
    console.error('exam-scope GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/** 시험범위 프리셋 저장 */
export async function POST(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { name?: string; dbEntries?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) {
    return NextResponse.json({ error: '시험범위 이름을 입력해주세요.' }, { status: 400 });
  }
  if (!Array.isArray(body.dbEntries) || body.dbEntries.length === 0) {
    return NextResponse.json({ error: 'DB 항목이 없습니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');

    // 최대 개수 초과 시 가장 오래된 것 삭제
    const count = await db.collection(COLLECTION).countDocuments({ loginId });
    if (count >= MAX_PRESETS) {
      const oldest = await db
        .collection(COLLECTION)
        .findOne({ loginId }, { sort: { savedAt: 1 }, projection: { _id: 1 } });
      if (oldest) {
        await db.collection(COLLECTION).deleteOne({ _id: oldest._id });
      }
    }

    const doc = {
      loginId,
      name,
      dbEntries: body.dbEntries,
      savedAt: new Date(),
    };

    const result = await db.collection(COLLECTION).insertOne(doc);
    return NextResponse.json({ id: result.insertedId.toString(), name, savedAt: doc.savedAt });
  } catch (e) {
    console.error('exam-scope POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

/** 시험범위 프리셋 삭제 */
export async function DELETE(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection(COLLECTION).deleteOne({ _id: oid, loginId });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('exam-scope DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
