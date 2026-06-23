import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_MATERIALS_COLLECTION,
  ensureMaterialIndexes,
  isMaterialType,
  sanitizeBlocks,
  type VipMaterial,
} from '@/lib/vip-material-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function listView(m: VipMaterial) {
  return {
    id: String(m._id),
    type: m.type,
    title: m.title,
    grade: m.grade ?? '',
    subtitle: m.subtitle ?? '',
    blockCount: Array.isArray(m.blocks) ? m.blocks.length : 0,
    updatedAt: m.updatedAt ?? m.createdAt,
    createdAt: m.createdAt,
  };
}

/** GET ?type= &q= — 내 교재 목록(최근 수정순). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureMaterialIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const type = (sp.get('type') || '').trim();
  const q = (sp.get('q') || '').trim();
  const filter: Record<string, unknown> = { userId: uid };
  if (isMaterialType(type)) filter.type = type;
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ title: { $regex: esc, $options: 'i' } }, { subtitle: { $regex: esc, $options: 'i' } }];
  }

  const list = await db.collection<VipMaterial>(VIP_MATERIALS_COLLECTION)
    .find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(300).toArray();
  return NextResponse.json({ ok: true, materials: list.map(listView) });
}

/** POST { type, title, grade?, subtitle?, blocks? } — 교재 생성. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const type = isMaterialType(body.type) ? body.type : '특강';
  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  if (!title) return NextResponse.json({ error: '교재 제목을 입력하세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureMaterialIndexes(db);
  const now = new Date();
  const doc: VipMaterial = {
    userId: new ObjectId(auth.userId),
    type, title,
    ...(typeof body.grade === 'string' && body.grade.trim() ? { grade: body.grade.trim().slice(0, 40) } : {}),
    ...(typeof body.subtitle === 'string' && body.subtitle.trim() ? { subtitle: body.subtitle.trim().slice(0, 200) } : {}),
    blocks: sanitizeBlocks(body.blocks),
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection(VIP_MATERIALS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}
