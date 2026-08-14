import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { HOME_NOTICE_COLLECTION, isSafeNoticeLink, normalizeNoticeInput } from '@/lib/home-notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toOid(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/** 관리자 — 홈 공지 수정 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await context.params;
  const oid = toOid(id);
  if (!oid) return NextResponse.json({ ok: false, error: '잘못된 공지입니다.' }, { status: 400 });

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeNoticeInput(raw);

  if (!input.title) {
    return NextResponse.json({ ok: false, error: '한 줄 문구(제목)를 입력해 주세요.' }, { status: 400 });
  }
  if (!isSafeNoticeLink(input.linkUrl)) {
    return NextResponse.json(
      { ok: false, error: '링크는 내부 경로(/…) 또는 http(s) 주소만 넣을 수 있습니다.' },
      { status: 400 },
    );
  }

  const db = await getDb('gomijoshua');
  const res = await db
    .collection(HOME_NOTICE_COLLECTION)
    .updateOne({ _id: oid }, { $set: { ...input, updatedAt: new Date() } });

  if (res.matchedCount === 0) {
    return NextResponse.json({ ok: false, error: '공지를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** 관리자 — 홈 공지 삭제 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await context.params;
  const oid = toOid(id);
  if (!oid) return NextResponse.json({ ok: false, error: '잘못된 공지입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const res = await db.collection(HOME_NOTICE_COLLECTION).deleteOne({ _id: oid });
  if (res.deletedCount === 0) {
    return NextResponse.json({ ok: false, error: '공지를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
