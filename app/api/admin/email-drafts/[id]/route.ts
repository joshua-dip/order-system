import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { DRAFTS_COLLECTION } from '@/lib/email-drafts-store';

/** PATCH /api/admin/email-drafts/[id] — 초안 수정 (to/subject/message) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.to === 'string') $set.to = body.to.trim();
  if (typeof body.subject === 'string') $set.subject = body.subject.trim();
  if (typeof body.message === 'string') $set.message = body.message.trim();

  const db = await getDb('gomijoshua');
  await db.collection(DRAFTS_COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/email-drafts/[id] — 초안 삭제 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

  const db = await getDb('gomijoshua');
  await db.collection(DRAFTS_COLLECTION).deleteOne({ _id: new ObjectId(id) });

  return NextResponse.json({ ok: true });
}
