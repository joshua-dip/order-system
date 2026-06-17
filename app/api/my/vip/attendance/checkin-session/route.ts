import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { publicBaseUrl } from '@/lib/public-base-url';
import {
  getAttendanceDb,
  ensureAttendanceIndexes,
  generateCheckinToken,
  normalizeDate,
  VIP_CLASSES_COLLECTION,
  VIP_CHECKIN_SESSIONS_COLLECTION,
  type VipCheckinSession,
} from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Key = { userId: ObjectId; classId: ObjectId; date: string; sessionLabel: string };

function parseKey(
  auth: { userId: string },
  classIdRaw: unknown,
  dateRaw: unknown,
  labelRaw: unknown,
): Key | null {
  const classId = typeof classIdRaw === 'string' && ObjectId.isValid(classIdRaw) ? classIdRaw : '';
  const date = normalizeDate(dateRaw);
  if (!classId || !date) return null;
  return {
    userId: new ObjectId(auth.userId),
    classId: new ObjectId(classId),
    date,
    sessionLabel: typeof labelRaw === 'string' ? labelRaw.trim().slice(0, 30) : '',
  };
}

/** GET — 해당 (반,날짜,교시)의 체크인 세션 상태 복원 */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const sp = request.nextUrl.searchParams;
  const key = parseKey(auth, sp.get('classId'), sp.get('date'), sp.get('sessionLabel'));
  if (!key) return NextResponse.json({ error: '반과 날짜를 선택해 주세요.' }, { status: 400 });

  const db = await getAttendanceDb();
  const s = await db.collection<VipCheckinSession>(VIP_CHECKIN_SESSIONS_COLLECTION).findOne(key);
  return NextResponse.json({ ok: true, session: s ? { token: s.token, open: s.open } : null });
}

/** POST — QR 체크인 세션 열기(없으면 생성). 토큰 반환 */
export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const key = parseKey(auth, body.classId, body.date, body.sessionLabel);
  if (!key) return NextResponse.json({ error: '반과 날짜를 선택해 주세요.' }, { status: 400 });

  const db = await getAttendanceDb();
  await ensureAttendanceIndexes(db);

  const cls = await db.collection(VIP_CLASSES_COLLECTION).findOne({ _id: key.classId, userId: key.userId });
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });

  await db.collection<VipCheckinSession>(VIP_CHECKIN_SESSIONS_COLLECTION).updateOne(
    key,
    {
      $set: { open: true, closedAt: null },
      $setOnInsert: { ...key, token: generateCheckinToken(), createdAt: new Date() },
    },
    { upsert: true },
  );
  const s = await db.collection<VipCheckinSession>(VIP_CHECKIN_SESSIONS_COLLECTION).findOne(key);
  const tok = s?.token ?? '';
  return NextResponse.json({ ok: true, token: tok, url: `${publicBaseUrl(request)}/checkin/${tok}`, open: true });
}

/** PATCH — 체크인 세션 닫기 */
export async function PATCH(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const key = parseKey(auth, body.classId, body.date, body.sessionLabel);
  if (!key) return NextResponse.json({ error: '반과 날짜를 선택해 주세요.' }, { status: 400 });

  const db = await getAttendanceDb();
  await db
    .collection<VipCheckinSession>(VIP_CHECKIN_SESSIONS_COLLECTION)
    .updateOne(key, { $set: { open: false, closedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
