import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { MEMBER_EXAM_SCOPE_COLLECTION, normalizeScopeInput } from '@/lib/member-exam-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: '잘못된 항목입니다.' }, { status: 400 });

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeScopeInput(raw);

  const db = await getDb('gomijoshua');
  const r = await db
    .collection(MEMBER_EXAM_SCOPE_COLLECTION)
    .updateOne({ _id: new ObjectId(id) }, { $set: { ...input, updatedAt: new Date() } });
  if (r.matchedCount === 0) return NextResponse.json({ ok: false, error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ ok: false, error: '잘못된 항목입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const r = await db.collection(MEMBER_EXAM_SCOPE_COLLECTION).deleteOne({ _id: new ObjectId(id) });
  if (r.deletedCount === 0) return NextResponse.json({ ok: false, error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
