import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string; recordId: string }> }
) {
  const userId = await getOwnerId(request);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { studentId, recordId } = await params;
  if (!ObjectId.isValid(studentId) || !ObjectId.isValid(recordId)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const studentOid = new ObjectId(studentId);
    const st = await db.collection(STUDENTS).findOne({ _id: studentOid, userId });
    if (!st) {
      return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });
    }

    const result = await db.collection(GRADES).deleteOne({
      _id: new ObjectId(recordId),
      userId,
      studentId: studentOid,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('school-grades DELETE:', e);
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
