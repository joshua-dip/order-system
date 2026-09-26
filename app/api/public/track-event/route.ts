import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/mongodb';
import { koreaDateKey } from '@/lib/korea-date-key';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  SITE_EVENTS_COLLECTION,
  ensureSiteEventIndexes,
  normalizeUsagePath,
  sanitizeProps,
  usageMenuOf,
  type SiteEventDoc,
} from '@/lib/site-usage';

/** 행동 기록(주문서 생성·쏠북 상품 클릭 등) — lib/track-event.ts 의 trackEvent() 가 보낸다. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    /* sendBeacon 은 text/plain 으로 보낸다 */
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) : '';
  if (!name) return NextResponse.json({ ok: false }, { status: 400 });
  const path = normalizeUsagePath(typeof body.path === 'string' ? body.path : '/');
  if (path.startsWith('/admin')) return NextResponse.json({ ok: true, skipped: true });

  try {
    const db = await getDb('gomijoshua');
    await ensureSiteEventIndexes(db);
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const session = token ? await verifyToken(token) : null;
    const visitorId = request.cookies.get('sv_id')?.value?.trim() || `anon-${randomUUID()}`;
    const doc: SiteEventDoc = {
      ts: new Date(),
      date: koreaDateKey(),
      type: 'event',
      name,
      path,
      menu: usageMenuOf(path).key,
      visitorId,
      ...(session?.loginId ? { loginId: String(session.loginId), role: String(session.role ?? '') } : {}),
      ...(sanitizeProps(body.props) ? { props: sanitizeProps(body.props) } : {}),
    };
    await db.collection(SITE_EVENTS_COLLECTION).insertOne(doc);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('track-event:', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
