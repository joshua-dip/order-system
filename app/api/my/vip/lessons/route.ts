import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import { VIP_CLASSES_COLLECTION } from '@/lib/attendance-store';
import { VIP_LESSON_LOGS_COLLECTION, ensureLessonIndexes, type VipLessonLog } from '@/lib/vip-lesson-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(l: VipLessonLog) {
  return {
    id: String(l._id),
    classId: String(l.classId),
    className: l.className,
    date: l.date,
    progress: l.progress,
    homework: l.homework ?? '',
    memo: l.memo ?? '',
    createdAt: l.createdAt,
  };
}

/** GET ?classId= (선택) — 수업일지 목록(최신순). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'lessons');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureLessonIndexes(db);
  const uid = new ObjectId(auth.userId);

  const filter: Record<string, unknown> = { userId: uid };
  const cid = request.nextUrl.searchParams.get('classId');
  if (cid && ObjectId.isValid(cid)) filter.classId = new ObjectId(cid);

  const list = await db.collection<VipLessonLog>(VIP_LESSON_LOGS_COLLECTION)
    .find(filter).sort({ date: -1, createdAt: -1 }).limit(300).toArray();
  return NextResponse.json({ ok: true, logs: list.map(view) });
}

/** POST { classId, date, progress, homework?, memo? } — 수업일지 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'lessons');
  if (auth instanceof NextResponse) return auth;
  let body: { classId?: unknown; date?: unknown; progress?: unknown; homework?: unknown; memo?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const classIdRaw = String(body.classId ?? '');
  const date = String(body.date ?? '');
  const progress = (typeof body.progress === 'string' ? body.progress : '').trim().slice(0, 2000);
  if (!ObjectId.isValid(classIdRaw)) return NextResponse.json({ error: '반을 선택하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  if (!progress) return NextResponse.json({ error: '진도(수업 내용)를 입력하세요.' }, { status: 400 });
  const homework = typeof body.homework === 'string' ? body.homework.slice(0, 1000) : undefined;
  const memo = typeof body.memo === 'string' ? body.memo.slice(0, 1000) : undefined;

  const db = await getVipDb();
  await ensureLessonIndexes(db);
  const uid = new ObjectId(auth.userId);
  const cls = await db.collection(VIP_CLASSES_COLLECTION).findOne({ _id: new ObjectId(classIdRaw), userId: uid });
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });

  const doc: VipLessonLog = {
    userId: uid, classId: cls._id as ObjectId, className: String((cls as { name?: string }).name ?? ''),
    date, progress, ...(homework !== undefined ? { homework } : {}), ...(memo !== undefined ? { memo } : {}), createdAt: new Date(),
  };
  const r = await db.collection(VIP_LESSON_LOGS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { date?, progress?, homework?, memo? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'lessons');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: { date?: unknown; progress?: unknown; homework?: unknown; memo?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;
  if (typeof body.progress === 'string' && body.progress.trim()) set.progress = body.progress.trim().slice(0, 2000);
  if (typeof body.homework === 'string') set.homework = body.homework.slice(0, 1000);
  if (typeof body.memo === 'string') set.memo = body.memo.slice(0, 1000);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_LESSON_LOGS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'lessons');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_LESSON_LOGS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
