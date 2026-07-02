import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 과외 시간표 슬롯 컬렉션 — (userId) 스코프. */
const TIMETABLE_COLLECTION = 'vip_tutoring_timetable';

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
/** 'HH:MM' 형식 검증 후 정규화. 실패 시 ''. */
function timeStr(v: unknown): string {
  const s = str(v, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}
function dayIndex(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : -1;
}

/** GET — 내 과외 시간표 전체 (요일·시작시간 순) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'tutoring');
  if (auth instanceof NextResponse) return auth;

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const docs = await db
    .collection(TIMETABLE_COLLECTION)
    .find({ userId })
    .sort({ dayOfWeek: 1, startTime: 1 })
    .limit(1000)
    .toArray();

  const slots = docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    studentName: d.studentName ?? '',
    dayOfWeek: typeof d.dayOfWeek === 'number' ? d.dayOfWeek : 0,
    startTime: d.startTime ?? '',
    endTime: d.endTime ?? '',
    subject: d.subject ?? '',
    memo: d.memo ?? '',
  }));
  return NextResponse.json({ ok: true, slots });
}

/** POST — 시간표 슬롯 추가 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'tutoring');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const studentName = str(body.studentName, 60);
  if (!studentName) return NextResponse.json({ error: '학생 이름을 입력해 주세요.' }, { status: 400 });
  const dayOfWeek = dayIndex(body.dayOfWeek);
  if (dayOfWeek < 0) return NextResponse.json({ error: '요일을 선택해 주세요.' }, { status: 400 });
  const startTime = timeStr(body.startTime);
  if (!startTime) return NextResponse.json({ error: '시작 시간을 HH:MM 형식으로 입력해 주세요.' }, { status: 400 });
  const endTime = timeStr(body.endTime); // 선택

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const r = await db.collection(TIMETABLE_COLLECTION).insertOne({
    userId,
    studentName,
    dayOfWeek,
    startTime,
    endTime,
    subject: str(body.subject, 40),
    memo: str(body.memo, 500),
    createdAt: new Date(),
  });
  return NextResponse.json({ ok: true, id: r.insertedId.toString() });
}

/** DELETE — 내 시간표 슬롯 삭제 */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'tutoring');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const id = str(body.id, 40) || str(request.nextUrl.searchParams.get('id'), 40);
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const r = await db.collection(TIMETABLE_COLLECTION).deleteOne({ _id: new ObjectId(id), userId });
  if (r.deletedCount === 0) return NextResponse.json({ error: '삭제할 항목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
