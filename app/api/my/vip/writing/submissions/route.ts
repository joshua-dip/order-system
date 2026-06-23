import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import {
  VIP_WRITING_TOPICS_COLLECTION,
  VIP_WRITING_SUBMISSIONS_COLLECTION,
  ensureWritingIndexes,
  countWords,
  type VipWritingTopic,
  type VipWritingSubmission,
} from '@/lib/vip-writing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(s: VipWritingSubmission) {
  return {
    id: String(s._id),
    topicId: s.topicId ? String(s.topicId) : null,
    topicTitle: s.topicTitle,
    studentId: String(s.studentId),
    studentName: s.studentName,
    date: s.date,
    original: s.original,
    corrected: s.corrected ?? '',
    feedback: s.feedback ?? '',
    score: typeof s.score === 'number' ? s.score : null,
    status: s.status,
    wordCount: countWords(s.original),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? null,
  };
}

/** GET ?topicId= &studentId= &status= — 제출·첨삭 목록(최신순). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureWritingIndexes(db);
  const uid = new ObjectId(auth.userId);

  const filter: Record<string, unknown> = { userId: uid };
  const sp = request.nextUrl.searchParams;
  const topicId = sp.get('topicId');
  const studentId = sp.get('studentId');
  const status = sp.get('status');
  if (topicId && ObjectId.isValid(topicId)) filter.topicId = new ObjectId(topicId);
  if (studentId && ObjectId.isValid(studentId)) filter.studentId = new ObjectId(studentId);
  if (status === '제출' || status === '첨삭완료') filter.status = status;

  const list = await db.collection<VipWritingSubmission>(VIP_WRITING_SUBMISSIONS_COLLECTION)
    .find(filter).sort({ date: -1, createdAt: -1 }).limit(300).toArray();
  return NextResponse.json({ ok: true, submissions: list.map(view) });
}

/** POST { studentId, topicId?, date, original } — 학생 영작 제출 기록 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const studentIdRaw = String(body.studentId ?? '');
  const date = String(body.date ?? '');
  const original = (typeof body.original === 'string' ? body.original : '').trim().slice(0, 8000);
  if (!ObjectId.isValid(studentIdRaw)) return NextResponse.json({ error: '학생을 선택하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  if (!original) return NextResponse.json({ error: '학생 영작 원문을 입력하세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureWritingIndexes(db);
  const uid = new ObjectId(auth.userId);

  const student = await col<VipStudent>(db, 'students').findOne({ _id: new ObjectId(studentIdRaw), userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  let topicId: ObjectId | undefined;
  let topicTitle = '자유 주제';
  const topicIdRaw = String(body.topicId ?? '');
  if (topicIdRaw && ObjectId.isValid(topicIdRaw)) {
    const topic = await db.collection<VipWritingTopic>(VIP_WRITING_TOPICS_COLLECTION).findOne({ _id: new ObjectId(topicIdRaw), userId: uid });
    if (topic) { topicId = topic._id as ObjectId; topicTitle = topic.title; }
  }

  const doc: VipWritingSubmission = {
    userId: uid,
    ...(topicId ? { topicId } : {}),
    topicTitle,
    studentId: student._id as ObjectId,
    studentName: String(student.name ?? ''),
    date, original, status: '제출', createdAt: new Date(),
  };
  const r = await db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { original?, corrected?, feedback?, score?, status?, date? } — 첨삭 저장. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.original === 'string' && body.original.trim()) set.original = body.original.trim().slice(0, 8000);
  if (typeof body.corrected === 'string') set.corrected = body.corrected.slice(0, 8000);
  if (typeof body.feedback === 'string') set.feedback = body.feedback.slice(0, 3000);
  if (body.score !== undefined) {
    const n = Number(body.score);
    set.score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  if (body.status === '제출' || body.status === '첨삭완료') set.status = body.status;
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '제출물을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
