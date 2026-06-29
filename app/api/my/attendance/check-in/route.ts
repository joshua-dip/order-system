import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { recordPointLedger } from '@/lib/point-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 일일 출석 보상 — 내 정보에서 하루 1회 랜덤 포인트(100~1000, 10단위) 적립.
 * 기준일은 KST(UTC+9). users.lastAttendanceDate('YYYY-MM-DD')로 중복 방지.
 *   GET  → 오늘 받았는지 상태
 *   POST → 출석 처리(랜덤 적립). 이미 받았으면 alreadyClaimed.
 */

const MIN_POINTS = 100;
const MAX_POINTS = 1000;
const STEP = 10;

/** KST 기준 'YYYY-MM-DD' */
function kstDateString(d: Date = new Date()): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 100~1000 사이 10단위 랜덤 포인트 */
function randomReward(): number {
  const steps = Math.floor((MAX_POINTS - MIN_POINTS) / STEP) + 1; // 91
  return MIN_POINTS + Math.floor(Math.random() * steps) * STEP;
}

async function getUserId(request: NextRequest): Promise<ObjectId | NextResponse> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload?.sub) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    return new ObjectId(payload.sub);
  } catch {
    return NextResponse.json({ error: '잘못된 계정입니다.' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const uid = await getUserId(request);
  if (uid instanceof NextResponse) return uid;

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: uid },
    { projection: { points: 1, lastAttendanceDate: 1 } },
  );
  const today = kstDateString();
  const claimedToday = (user as { lastAttendanceDate?: string } | null)?.lastAttendanceDate === today;
  const rawPts = (user as { points?: unknown } | null)?.points;
  const points = typeof rawPts === 'number' ? rawPts : 0;
  return NextResponse.json({ ok: true, claimedToday, points, min: MIN_POINTS, max: MAX_POINTS });
}

export async function POST(request: NextRequest) {
  const uid = await getUserId(request);
  if (uid instanceof NextResponse) return uid;

  const db = await getDb('gomijoshua');
  const users = db.collection('users');
  const today = kstDateString();
  const reward = randomReward();

  // 원자적 조건부 적립 — 오늘 아직 안 받았을 때만 (동시 클릭 중복 방지)
  const res = await users.updateOne(
    { _id: uid, lastAttendanceDate: { $ne: today } },
    { $inc: { points: reward }, $set: { lastAttendanceDate: today, lastAttendanceAt: new Date() } },
  );

  if (res.matchedCount === 0) {
    const cur = await users.findOne({ _id: uid }, { projection: { points: 1 } });
    const rawCur = (cur as { points?: unknown } | null)?.points;
    const pts = typeof rawCur === 'number' ? rawCur : 0;
    return NextResponse.json({ ok: false, alreadyClaimed: true, points: pts }, { status: 409 });
  }

  const after = await users.findOne({ _id: uid }, { projection: { points: 1 } });
  const rawPts = (after as { points?: unknown } | null)?.points;
  const balanceAfter = typeof rawPts === 'number' && rawPts >= 0 ? rawPts : reward;

  await recordPointLedger(db, {
    userId: uid,
    delta: reward,
    balanceAfter,
    kind: 'attendance',
    meta: { date: today, reward },
  }).catch((e) => console.error('attendance ledger:', e));

  return NextResponse.json({ ok: true, reward, balanceAfter, claimedToday: true });
}
