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

function listView(s: VipWordSet) {
  return {
    id: String(s._id),
    title: s.title,
    folder: s.folder ?? '',
    textbook: s.textbook ?? '',
    wordCount: Array.isArray(s.words) ? s.words.length : 0,
    updatedAt: s.updatedAt ?? s.createdAt,
    createdAt: s.createdAt,
  };
}

/** GET ?folder= &q= — 단어장 목록(최근 수정순) + 폴더 목록. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'words');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureWordSetIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const folder = sp.get('folder');
  const q = (sp.get('q') || '').trim();
  const filter: Record<string, unknown> = { userId: uid };
  if (folder !== null && folder !== '__all__') filter.folder = folder;
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ title: { $regex: esc, $options: 'i' } }, { textbook: { $regex: esc, $options: 'i' } }];
  }

  const col = db.collection<VipWordSet>(VIP_WORD_SETS_COLLECTION);
  const [list, folders] = await Promise.all([
    col.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(300).toArray(),
    col.aggregate([{ $match: { userId: uid } }, { $group: { _id: '$folder', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);
  return NextResponse.json({
    ok: true,
    sets: list.map(listView),
    folders: folders.map((f) => ({ name: String(f._id ?? ''), count: f.count as number })),
  });
}

/** POST { title, folder?, textbook?, words? } — 단어장 생성. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'words');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  if (!title) return NextResponse.json({ error: '단어장 제목을 입력하세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureWordSetIndexes(db);
  const now = new Date();
  const doc: VipWordSet = {
    userId: new ObjectId(auth.userId),
    title,
    folder: typeof body.folder === 'string' ? body.folder.trim().slice(0, 60) : '',
    ...(typeof body.textbook === 'string' && body.textbook.trim() ? { textbook: body.textbook.trim().slice(0, 120) } : {}),
    words: sanitizeWords(body.words),
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection(VIP_WORD_SETS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}
