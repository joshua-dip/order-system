import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_MEMOS_COLLECTION,
  ensureMemoIndexes,
  isMemoColor,
  type VipMemo,
} from '@/lib/vip-memo-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(m: VipMemo) {
  return {
    id: String(m._id),
    title: m.title,
    content: m.content,
    color: m.color,
    pinned: m.pinned,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? null,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET ?q= — 메모 목록(고정 먼저, 최신순). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'memo');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureMemoIndexes(db);
  const uid = new ObjectId(auth.userId);

  const filter: Record<string, unknown> = { userId: uid };
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ title: rx }, { content: rx }];
  }

  const list = await db
    .collection<VipMemo>(VIP_MEMOS_COLLECTION)
    .find(filter)
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(500)
    .toArray();

  return NextResponse.json({ ok: true, memos: list.map(view) });
}

/** POST { content, title?, color?, pinned? } — 메모 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'memo');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const content = (typeof body.content === 'string' ? body.content : '').trim().slice(0, 5000);
  if (!content) return NextResponse.json({ error: '메모 내용을 입력하세요.' }, { status: 400 });
  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 120);
  const color = isMemoColor(body.color) ? body.color : 'default';
  const pinned = body.pinned === true;

  const db = await getVipDb();
  await ensureMemoIndexes(db);
  const uid = new ObjectId(auth.userId);

  const now = new Date();
  const doc: VipMemo = { userId: uid, title, content, color, pinned, createdAt: now, updatedAt: now };
  const r = await db.collection(VIP_MEMOS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { title?, content?, color?, pinned? } — 수정 / 고정 토글. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'memo');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') set.title = body.title.trim().slice(0, 120);
  if (typeof body.content === 'string') set.content = body.content.trim().slice(0, 5000);
  if (isMemoColor(body.color)) set.color = body.color;
  if (typeof body.pinned === 'boolean') set.pinned = body.pinned;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_MEMOS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '메모를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'memo');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_MEMOS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
