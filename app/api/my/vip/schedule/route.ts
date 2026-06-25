import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_SCHEDULES_COLLECTION,
  ensureScheduleIndexes,
  isScheduleCategory,
  type VipSchedule,
} from '@/lib/vip-schedule-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(s: VipSchedule) {
  return {
    id: String(s._id),
    title: s.title,
    date: s.date,
    time: s.time ?? '',
    category: s.category,
    description: s.description,
    createdAt: s.createdAt,
  };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** GET ?month=YYYY-MM &category= — 일정 목록 + 요약(다가오는 일정). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'schedule');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureScheduleIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const month = sp.get('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) filter.date = { $regex: '^' + month };
  const category = sp.get('category');
  if (isScheduleCategory(category)) filter.category = category;

  // 가까운 일정 먼저(오름차순).
  const list = await db
    .collection<VipSchedule>(VIP_SCHEDULES_COLLECTION)
    .find(filter)
    .sort({ date: 1, time: 1, createdAt: 1 })
    .limit(500)
    .toArray();

  const now = new Date();
  const today = ymd(now);
  const upcoming = await db.collection(VIP_SCHEDULES_COLLECTION).countDocuments({ userId: uid, date: { $gte: today } });

  return NextResponse.json({ ok: true, records: list.map(view), summary: { today, upcoming } });
}

/** POST { title, date, time?, category?, description? } — 일정 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'schedule');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  const date = String(body.date ?? '');
  if (!title) return NextResponse.json({ error: '일정 제목을 입력하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  const category = isScheduleCategory(body.category) ? body.category : '기타';
  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : undefined;
  const description = (typeof body.description === 'string' ? body.description : '').trim().slice(0, 1000);

  const db = await getVipDb();
  await ensureScheduleIndexes(db);
  const uid = new ObjectId(auth.userId);

  const doc: VipSchedule = {
    userId: uid,
    title,
    date,
    category,
    description,
    ...(time !== undefined ? { time } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const r = await db.collection(VIP_SCHEDULES_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { title?, date?, time?, category?, description? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'schedule');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') set.title = body.title.trim().slice(0, 160);
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;
  if (typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time)) set.time = body.time;
  if (isScheduleCategory(body.category)) set.category = body.category;
  if (typeof body.description === 'string') set.description = body.description.trim().slice(0, 1000);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_SCHEDULES_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '일정을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'schedule');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_SCHEDULES_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
