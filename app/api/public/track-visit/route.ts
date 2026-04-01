import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { koreaDateKey } from '@/lib/korea-date-key';

const COOKIE = 'sv_id';
const COL_STATS = 'site_stats_daily';
const COL_VISITOR = 'site_visitor_day';

type SiteStatsDaily = {
  _id: string;
  pageViews?: number;
  uniqueVisitors?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

let indexesEnsured = false;

async function ensureIndexes(db: Awaited<ReturnType<typeof getDb>>) {
  if (indexesEnsured) return;
  try {
    await db.collection(COL_VISITOR).createIndex({ date: 1, visitorId: 1 }, { unique: true });
    await db.collection(COL_VISITOR).createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
    indexesEnsured = true;
  } catch {
    /* ignore */
  }
}

/**
 * 공개 사이트 방문 기록(페이지 조회·당일 순방문 추정). /admin 경로는 집계하지 않음.
 */
export async function POST(request: NextRequest) {
  let path = '';
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    path = typeof body.path === 'string' ? body.path : '';
  } catch {
    path = '';
  }

  if (path.startsWith('/admin')) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let visitorId = request.cookies.get(COOKIE)?.value?.trim() || '';
  if (!visitorId || visitorId.length < 8) {
    visitorId = randomUUID();
  }

  const date = koreaDateKey();
  const now = new Date();

  try {
    const db = await getDb('gomijoshua');
    await ensureIndexes(db);

    await db.collection<SiteStatsDaily>(COL_STATS).updateOne(
      { _id: date },
      {
        $inc: { pageViews: 1 },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    try {
      const ins = await db.collection(COL_VISITOR).insertOne({
        date,
        visitorId,
        createdAt: now,
      });
      if (ins.insertedId) {
        await db.collection<SiteStatsDaily>(COL_STATS).updateOne(
          { _id: date },
          { $inc: { uniqueVisitors: 1 }, $set: { updatedAt: now } }
        );
      }
    } catch (e: unknown) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: number }).code : 0;
      if (code !== 11000) throw e;
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, visitorId, {
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
    return res;
  } catch (e) {
    console.error('track-visit:', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
