import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_WRITING_TOPICS_COLLECTION,
  VIP_WRITING_SUBMISSIONS_COLLECTION,
  ensureWritingIndexes,
  isWritingLevel,
  type VipWritingTopic,
} from '@/lib/vip-writing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(t: VipWritingTopic, submissionCount = 0) {
  return {
    id: String(t._id),
    title: t.title,
    prompt: t.prompt,
    targetWords: t.targetWords ?? null,
    level: t.level,
    reference: t.reference ?? '',
    submissionCount,
    createdAt: t.createdAt,
  };
}

/** GET — 영작 주제 목록(최신순) + 주제별 제출 수. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureWritingIndexes(db);
  const uid = new ObjectId(auth.userId);

  const topics = await db.collection<VipWritingTopic>(VIP_WRITING_TOPICS_COLLECTION)
    .find({ userId: uid }).sort({ createdAt: -1 }).limit(300).toArray();

  // 주제별 제출 수
  const counts = await db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).aggregate([
    { $match: { userId: uid, topicId: { $ne: null } } },
    { $group: { _id: '$topicId', n: { $sum: 1 } } },
  ]).toArray();
  const countMap = new Map<string, number>(counts.map((c) => [String(c._id), c.n as number]));

  return NextResponse.json({ ok: true, topics: topics.map((t) => view(t, countMap.get(String(t._id)) ?? 0)) });
}

/** POST { title, prompt, targetWords?, level?, reference? } — 주제 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 120);
  const prompt = (typeof body.prompt === 'string' ? body.prompt : '').trim().slice(0, 2000);
  if (!title) return NextResponse.json({ error: '주제 제목을 입력하세요.' }, { status: 400 });

  const targetWordsRaw = Number(body.targetWords);
  const targetWords = Number.isFinite(targetWordsRaw) && targetWordsRaw > 0 ? Math.min(2000, Math.floor(targetWordsRaw)) : undefined;
  const level = isWritingLevel(body.level) ? body.level : '중급';
  const reference = typeof body.reference === 'string' ? body.reference.slice(0, 4000) : undefined;

  const db = await getVipDb();
  await ensureWritingIndexes(db);
  const doc: VipWritingTopic = {
    userId: new ObjectId(auth.userId), title, prompt, level,
    ...(targetWords !== undefined ? { targetWords } : {}),
    ...(reference ? { reference } : {}),
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_WRITING_TOPICS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { title?, prompt?, targetWords?, level?, reference? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) set.title = body.title.trim().slice(0, 120);
  if (typeof body.prompt === 'string') set.prompt = body.prompt.trim().slice(0, 2000);
  if (isWritingLevel(body.level)) set.level = body.level;
  if (typeof body.reference === 'string') set.reference = body.reference.slice(0, 4000);
  if (body.targetWords !== undefined) {
    const n = Number(body.targetWords);
    set.targetWords = Number.isFinite(n) && n > 0 ? Math.min(2000, Math.floor(n)) : null;
  }

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_WRITING_TOPICS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '주제를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= — 주제 삭제 (제출물은 topicId 만 비움, 기록은 유지). */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const oid = new ObjectId(id);
  const r = await db.collection(VIP_WRITING_TOPICS_COLLECTION).deleteOne({ _id: oid, userId: uid });
  if (r.deletedCount > 0) {
    await db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).updateMany({ userId: uid, topicId: oid }, { $set: { topicId: null } });
  }
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
