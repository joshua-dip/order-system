import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { sanitizeQuickMenu } from '@/lib/quick-menu';

export const dynamic = 'force-dynamic';

async function me(request: NextRequest): Promise<ObjectId | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  return payload?.sub && ObjectId.isValid(payload.sub) ? new ObjectId(payload.sub) : null;
}

/** 내 자주 쓰는 메뉴 — users.quickMenu (없으면 null → 화면이 추천을 보여 준다) */
export async function GET(request: NextRequest) {
  const userId = await me(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = await getDb('gomijoshua');
  const u = await db.collection('users').findOne({ _id: userId }, { projection: { quickMenu: 1 } });
  return NextResponse.json({ items: Array.isArray(u?.quickMenu) ? sanitizeQuickMenu(u.quickMenu) : null });
}

/** 저장 — body { items: string[] } */
export async function PUT(request: NextRequest) {
  const userId = await me(request);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { items?: unknown };
  const items = sanitizeQuickMenu(body.items);
  const db = await getDb('gomijoshua');
  const r = await db.collection('users').updateOne({ _id: userId }, { $set: { quickMenu: items, quickMenuUpdatedAt: new Date() } });
  if (r.matchedCount === 0) return NextResponse.json({ error: '회원 정보를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, items });
}
