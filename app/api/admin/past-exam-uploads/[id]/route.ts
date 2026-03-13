import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const adminCategories = Array.isArray(body.adminCategories)
      ? body.adminCategories.filter((c: unknown) => typeof c === 'string').slice(0, 50)
      : [];

    const db = await getDb('gomijoshua');
    const result = await db.collection('pastExamUploads').updateOne(
      { _id: new ObjectId(id) },
      { $set: { adminCategories, adminClassifiedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('기출문제 유형 분류 저장 실패:', err);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
