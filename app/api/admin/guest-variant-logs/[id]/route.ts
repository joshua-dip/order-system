import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GUEST_GENERATED_QUESTIONS_COLLECTION } from '@/lib/guest-generated-questions-store';
import { serializeGuestLog } from '@/lib/guest-variant-logs-admin';

function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: '유효하지 않은 id' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const doc = await db
      .collection(GUEST_GENERATED_QUESTIONS_COLLECTION)
      .findOne({ _id: oid });
    if (!doc) return NextResponse.json({ error: '찾을 수 없습니다.' }, { status: 404 });

    // 연결된 generated_questions 존재 여부
    let existing_gq: string[] = [];
    const pid = (doc as { passage_id?: ObjectId }).passage_id;
    const type = (doc as { type?: string }).type;
    if (pid instanceof ObjectId && typeof type === 'string') {
      const rows = await db
        .collection('generated_questions')
        .find({ passage_id: pid, type }, { projection: { _id: 1 } })
        .limit(20)
        .toArray();
      existing_gq = rows.map((r) => String(r._id));
    }

    return NextResponse.json({ item: serializeGuestLog(doc), existing_gq });
  } catch (e) {
    console.error('guest-variant-logs GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/** 태그·메모·아카이브 토글 등 부분 업데이트 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: '유효하지 않은 id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문 필요' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};

  if (Array.isArray(body.tags)) {
    const uniq = Array.from(
      new Set(
        body.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    ).slice(0, 20);
    update.tags = uniq;
  }
  if (typeof body.note === 'string') {
    const n = body.note.trim().slice(0, 2000);
    if (n) update.note = n;
    else unset.note = '';
  }
  if (typeof body.archived === 'boolean') update.archived = body.archived;

  if (Object.keys(update).length === 0 && Object.keys(unset).length === 0) {
    return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 });
  }

  update.reviewed_at = new Date();
  if (payload?.loginId) update.reviewed_by = payload.loginId;

  try {
    const db = await getDb('gomijoshua');
    const mongoUpdate: Record<string, unknown> = { $set: update };
    if (Object.keys(unset).length > 0) mongoUpdate.$unset = unset;
    const r = await db
      .collection(GUEST_GENERATED_QUESTIONS_COLLECTION)
      .findOneAndUpdate({ _id: oid }, mongoUpdate, { returnDocument: 'after' });
    if (!r) return NextResponse.json({ error: '찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true, item: serializeGuestLog(r as Record<string, unknown>) });
  } catch (e) {
    console.error('guest-variant-logs PATCH:', e);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const oid = parseId(id);
  if (!oid) return NextResponse.json({ error: '유효하지 않은 id' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const r = await db
      .collection(GUEST_GENERATED_QUESTIONS_COLLECTION)
      .deleteOne({ _id: oid });
    if (r.deletedCount === 0) {
      return NextResponse.json({ error: '찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('guest-variant-logs DELETE:', e);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
