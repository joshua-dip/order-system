import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

const COL = 'my_schools';
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

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(COL)
      .find({ userId })
      .sort({ name: 1 })
      .project({ userId: 0 })
      .toArray();
    const schools = docs.map((d) => ({
      id: d._id.toString(),
      name: String(d.name ?? ''),
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
    }));
    return NextResponse.json({ schools });
  } catch (e) {
    console.error('my/schools GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return NextResponse.json({ error: '학교 이름을 입력해 주세요.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    const now = new Date();
    const r = await db.collection(COL).insertOne({ userId, name, createdAt: now });
    return NextResponse.json({ ok: true, school: { id: r.insertedId.toString(), name, createdAt: now.toISOString() } });
  } catch (e) {
    console.error('my/schools POST:', e);
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
    const del = await db.collection(COL).deleteOne({ _id: oid, userId });
    if (del.deletedCount === 0) return NextResponse.json({ error: '학교를 찾을 수 없습니다.' }, { status: 404 });
    await db.collection(SCOPES).deleteMany({ userId, schoolId: oid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('my/schools DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
