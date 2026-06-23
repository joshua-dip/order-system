import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import {
  VIP_COUNSELING_COLLECTION,
  ensureCounselingIndexes,
  isCounselingType,
  isCounselingStatus,
  counselingStatusOf,
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
    time: c.time ?? '',
    status: counselingStatusOf(c),
    type: c.type,
    content: c.content,
    nextPlan: c.nextPlan ?? '',
    createdAt: c.createdAt,
  };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** GET ?studentId= &status=예정|완료 — 상담 목록 + 요약(예정/이번달 완료). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureCounselingIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const sid = sp.get('studentId');
  if (sid && ObjectId.isValid(sid)) filter.studentId = new ObjectId(sid);
  const status = sp.get('status');
  if (status === '예정') filter.status = '예정';
  else if (status === '완료') filter.status = { $ne: '예정' }; // 옛 데이터(status 없음) 포함

  // 예정은 가까운 날짜 먼저(오름차순), 완료/전체는 최신순.
  const sort: Record<string, 1 | -1> = status === '예정' ? { date: 1, time: 1, createdAt: 1 } : { date: -1, createdAt: -1 };
  const list = await db.collection<VipCounseling>(VIP_COUNSELING_COLLECTION).find(filter).sort(sort).limit(400).toArray();

  // 요약 — 예정 건수 / 이번 달 완료 건수
  const now = new Date();
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const baseFilter: Record<string, unknown> = { userId: uid, ...(filter.studentId ? { studentId: filter.studentId } : {}) };
  const [upcomingCount, thisMonthDone] = await Promise.all([
    db.collection(VIP_COUNSELING_COLLECTION).countDocuments({ ...baseFilter, status: '예정' }),
    db.collection(VIP_COUNSELING_COLLECTION).countDocuments({ ...baseFilter, status: { $ne: '예정' }, date: { $gte: monthStart } }),
  ]);

  return NextResponse.json({ ok: true, records: list.map(view), summary: { upcoming: upcomingCount, thisMonthDone, today: ymd(now) } });
}

/** POST { studentId, date, time?, status?, type, content?, nextPlan? } — 상담 예약(예정)/기록(완료) 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const studentIdRaw = String(body.studentId ?? '');
  const date = String(body.date ?? '');
  const status = isCounselingStatus(body.status) ? body.status : '완료';
  const content = (typeof body.content === 'string' ? body.content : '').trim().slice(0, 2000);
  if (!ObjectId.isValid(studentIdRaw)) return NextResponse.json({ error: '학생을 선택하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  // 완료는 내용 필수, 예정(예약)은 안건(content) 선택.
  if (status === '완료' && !content) return NextResponse.json({ error: '상담 내용을 입력하세요.' }, { status: 400 });
  const type = isCounselingType(body.type) ? body.type : '기타';
  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : undefined;
  const nextPlan = typeof body.nextPlan === 'string' ? body.nextPlan.slice(0, 500) : undefined;

  const db = await getVipDb();
  await ensureCounselingIndexes(db);
  const uid = new ObjectId(auth.userId);
  const student = await col<VipStudent>(db, 'students').findOne({ _id: new ObjectId(studentIdRaw), userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const doc: VipCounseling = {
    userId: uid, studentId: student._id as ObjectId, studentName: String(student.name ?? ''),
    date, type, content, status,
    ...(time !== undefined ? { time } : {}),
    ...(nextPlan !== undefined ? { nextPlan } : {}),
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_COUNSELING_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { date?, time?, status?, type?, content?, nextPlan? } — 수정 / 완료 처리(status='완료'). */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'counseling');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;
  if (typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time)) set.time = body.time;
  if (isCounselingStatus(body.status)) set.status = body.status;
  if (isCounselingType(body.type)) set.type = body.type;
  if (typeof body.content === 'string') set.content = body.content.trim().slice(0, 2000);
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
