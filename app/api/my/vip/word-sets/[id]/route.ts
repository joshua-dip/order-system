import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_WORD_SETS_COLLECTION,
  ensureWordSetIndexes,
  sanitizeWords,
  type VipWordSet,
} from '@/lib/vip-word-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fullView(s: VipWordSet) {
  return {
    id: String(s._id),
    title: s.title,
    folder: s.folder ?? '',
    textbook: s.textbook ?? '',
    words: Array.isArray(s.words) ? s.words : [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? s.createdAt,
  };
}

/** GET — 단어장 1건(단어 포함). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'words');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const s = await db.collection<VipWordSet>(VIP_WORD_SETS_COLLECTION).findOne({ _id: new ObjectId(id), userId: uid });
  if (!s) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, set: fullView(s) });
}

/** PATCH { title?, folder?, textbook?, words? } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'words');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) set.title = body.title.trim().slice(0, 160);
  if (typeof body.folder === 'string') set.folder = body.folder.trim().slice(0, 60);
  if (typeof body.textbook === 'string') set.textbook = body.textbook.trim().slice(0, 120);
  if (body.words !== undefined) set.words = sanitizeWords(body.words);

  const db = await getVipDb();
  await ensureWordSetIndexes(db);
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_WORD_SETS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'words');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_WORD_SETS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
