import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipSchool } from '@/lib/vip-db';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json();
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  const $set: Record<string, unknown> = {};
  if (body.name) $set.name = body.name.trim();
  if (body.region !== undefined) $set.region = body.region.trim() || undefined;

  if (Object.keys($set).length === 0) {
    return NextResponse.json({ error: '수정할 내용이 없습니다.' }, { status: 400 });
  }

  const result = await col<VipSchool>(db, 'schools').updateOne(
    { _id: new ObjectId(id), userId: uid },
    { $set },
  );
  if (result.matchedCount === 0) {
    return NextResponse.json({ error: '학교를 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const schoolOid = new ObjectId(id);

  const studentCount = await col(db, 'students').countDocuments({ userId: uid, schoolId: schoolOid });
  if (studentCount > 0) {
    return NextResponse.json({ error: `이 학교에 학생 ${studentCount}명이 등록되어 있습니다. 먼저 학생을 삭제해주세요.` }, { status: 400 });
  }

  await col<VipSchool>(db, 'schools').deleteOne({ _id: schoolOid, userId: uid });
  return NextResponse.json({ ok: true });
}
