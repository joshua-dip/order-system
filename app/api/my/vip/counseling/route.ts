import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import {
  VIP_COUNSELING_COLLECTION,
  ensureCounselingIndexes,
  isCounselingType,
  type VipCounseling,
} from '@/lib/vip-counseling-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(c: VipCounseling) {
  return {
    id: String(c._id),
    studentId: String(c.studentId),
    studentName: c.studentName,
    date: c.date,
    type: c.type,
    content: c.content,
    nextPlan: c.nextPlan ?? '',
    createdAt: c.createdAt,
  };
}

/** GET ?studentId= (선택) — 상담 기록 목록(최신순). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureCounselingIndexes(db);
  const uid = new ObjectId(auth.userId);

  const filter: Record<string, unknown> = { userId: uid };
  const sid = request.nextUrl.searchParams.get('studentId');
  if (sid && ObjectId.isValid(sid)) filter.studentId = new ObjectId(sid);

  const list = await db.collection<VipCounseling>(VIP_COUNSELING_COLLECTION)
    .find(filter).sort({ date: -1, createdAt: -1 }).limit(300).toArray();
  return NextResponse.json({ ok: true, records: list.map(view) });
}

/** POST { studentId, date, type, content, nextPlan? } — 상담 기록 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  let body: { studentId?: unknown; date?: unknown; type?: unknown; content?: unknown; nextPlan?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const studentIdRaw = String(body.studentId ?? '');
  const date = String(body.date ?? '');
  const content = (typeof body.content === 'string' ? body.content : '').trim().slice(0, 2000);
  if (!ObjectId.isValid(studentIdRaw)) return NextResponse.json({ error: '학생을 선택하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  if (!content) return NextResponse.json({ error: '상담 내용을 입력하세요.' }, { status: 400 });
  const type = isCounselingType(body.type) ? body.type : '기타';
  const nextPlan = typeof body.nextPlan === 'string' ? body.nextPlan.slice(0, 500) : undefined;

  const db = await getVipDb();
  await ensureCounselingIndexes(db);
  const uid = new ObjectId(auth.userId);
  const student = await col<VipStudent>(db, 'students').findOne({ _id: new ObjectId(studentIdRaw), userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const doc: VipCounseling = {
    userId: uid, studentId: student._id as ObjectId, studentName: String(student.name ?? ''),
    date, type, content, ...(nextPlan !== undefined ? { nextPlan } : {}), createdAt: new Date(),
  };
  const r = await db.collection(VIP_COUNSELING_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { date?, type?, content?, nextPlan? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: { date?: unknown; type?: unknown; content?: unknown; nextPlan?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;
  if (isCounselingType(body.type)) set.type = body.type;
  if (typeof body.content === 'string' && body.content.trim()) set.content = body.content.trim().slice(0, 2000);
  if (typeof body.nextPlan === 'string') set.nextPlan = body.nextPlan.slice(0, 500);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_COUNSELING_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_COUNSELING_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
