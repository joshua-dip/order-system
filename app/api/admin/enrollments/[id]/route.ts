import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { ENROLLMENTS_COLLECTION } from '@/lib/enrollments-store';

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

  const action = typeof body.action === 'string' ? body.action : '';
  const $set: Record<string, unknown> = { updatedAt: new Date() };

  if (action === 'activate') {
    $set.status = 'active';
    $set.activatedAt = new Date();
  } else if (action === 'cancel') {
    $set.status = 'cancelled';
    $set.cancelledAt = new Date();
    if (typeof body.cancelReason === 'string') $set.cancelReason = body.cancelReason;
  } else if (action === 'complete') {
    $set.status = 'completed';
    $set.completedAt = new Date();
  } else if (action === 'refund') {
    $set.status = 'refunded';
  }

  if (typeof body.adminMemo === 'string') $set.adminMemo = body.adminMemo;
  if (typeof body.depositorName === 'string') $set.depositorName = body.depositorName;

  const db = await getDb('gomijoshua');
  await db.collection(ENROLLMENTS_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set });
  return NextResponse.json({ ok: true });
}
