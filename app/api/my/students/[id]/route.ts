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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 학생 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COLLECTION).findOne({
      _id: new ObjectId(id),
      userId,
    });
    if (!doc) {
      return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({
      student: {
        id: doc._id.toString(),
        school: String(doc.school ?? ''),
        grade: String(doc.grade ?? ''),
        name: String(doc.name ?? ''),
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : '',
      },
    });
  } catch (e) {
    console.error('my/students/[id] GET:', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 학생 ID입니다.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const $set: Record<string, string> = {};
  if (typeof b.school === 'string') {
    const v = b.school.trim();
    if (!v) return NextResponse.json({ error: '학교를 입력해 주세요.' }, { status: 400 });
    $set.school = v;
  }
  if (typeof b.grade === 'string') {
    const v = b.grade.trim();
    if (!v) return NextResponse.json({ error: '학년을 입력해 주세요.' }, { status: 400 });
    $set.grade = v;
  }
  if (typeof b.name === 'string') {
    const v = b.name.trim();
    if (!v) return NextResponse.json({ error: '이름을 입력해 주세요.' }, { status: 400 });
    $set.name = v;
  }

  if (Object.keys($set).length === 0) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection(COLLECTION).updateOne(
      { _id: new ObjectId(id), userId },
      { $set }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('my/students/[id] PATCH:', e);
    return NextResponse.json({ error: '수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 학생 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection(COLLECTION).deleteOne({
      _id: new ObjectId(id),
      userId,
    });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('my/students/[id] DELETE:', e);
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
