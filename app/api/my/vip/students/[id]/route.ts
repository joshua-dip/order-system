import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const student = await col<VipStudent>(db, 'students').findOne({ _id: new ObjectId(id), userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const school = await col(db, 'schools').findOne({ _id: student.schoolId }, { projection: { name: 1 } });

  return NextResponse.json({
    ok: true,
    student: {
      id: student._id!.toString(),
      schoolId: student.schoolId.toString(),
      schoolName: (school?.name as string) ?? '',
      name: student.name,
      grade: student.grade,
      academicYear: student.academicYear,
      status: student.status,
      examScope: student.examScope,
      memo: student.memo ?? '',
      phone: student.phone ?? '',
      parentPhone: student.parentPhone ?? '',
      createdAt: student.createdAt?.toISOString() ?? '',
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json();
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  const $set: Record<string, unknown> = {};
  if (body.name !== undefined) $set.name = body.name.trim();
  if (body.grade !== undefined) $set.grade = Number(body.grade);
  if (body.academicYear !== undefined) $set.academicYear = Number(body.academicYear);
  if (body.status !== undefined) $set.status = body.status;
  if (body.examScope !== undefined) $set.examScope = body.examScope;
  if (body.memo !== undefined) $set.memo = body.memo.trim() || undefined;
  if (body.phone !== undefined) $set.phone = body.phone.trim() || undefined;
  if (body.parentPhone !== undefined) $set.parentPhone = body.parentPhone.trim() || undefined;
  if (body.schoolId !== undefined) $set.schoolId = new ObjectId(body.schoolId);

  if (Object.keys($set).length === 0) {
    return NextResponse.json({ error: '수정할 내용이 없습니다.' }, { status: 400 });
  }

  const result = await col<VipStudent>(db, 'students').updateOne(
    { _id: new ObjectId(id), userId: uid },
    { $set },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  await col<VipStudent>(db, 'students').deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true });
}
