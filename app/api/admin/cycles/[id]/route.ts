import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { CYCLES_COLLECTION } from '@/lib/exam-cycles-store';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') $set.title = body.title.trim();
  if (typeof body.targetGrade === 'string') $set.targetGrade = body.targetGrade.trim();
  if (typeof body.totalWeeks === 'number') $set.totalWeeks = body.totalWeeks;
  if (typeof body.priceWon === 'number') $set.priceWon = body.priceWon;
  if (typeof body.description === 'string') $set.description = body.description.trim();
  if (typeof body.isActive === 'boolean') $set.isActive = body.isActive;
  if (Array.isArray(body.bulletPoints)) $set.bulletPoints = body.bulletPoints;
  if (typeof body.startAt === 'string') $set.startAt = new Date(body.startAt);
  if (typeof body.endAt === 'string') $set.endAt = new Date(body.endAt);

  const db = await getDb('gomijoshua');
  await db.collection(CYCLES_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  // 활성 enrollment 가 있으면 삭제 불가
  const hasActive = await db
    .collection('enrollments')
    .findOne({ cycleId: new ObjectId(id), status: { $in: ['pending_payment', 'active'] } });
  if (hasActive) {
    return NextResponse.json({ error: '진행 중인 등록이 있어 삭제할 수 없습니다.' }, { status: 409 });
  }

  await db.collection(CYCLES_COLLECTION).deleteOne({ _id: new ObjectId(id) });
  return NextResponse.json({ ok: true });
}
