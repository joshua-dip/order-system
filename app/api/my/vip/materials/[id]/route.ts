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

function fullView(m: VipMaterial) {
  return {
    id: String(m._id),
    type: m.type,
    title: m.title,
    grade: m.grade ?? '',
    subtitle: m.subtitle ?? '',
    blocks: Array.isArray(m.blocks) ? m.blocks : [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? m.createdAt,
  };
}

/** GET — 교재 1건(블록 포함). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const m = await db.collection<VipMaterial>(VIP_MATERIALS_COLLECTION).findOne({ _id: new ObjectId(id), userId: uid });
  if (!m) return NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, material: fullView(m) });
}

/** PATCH { title?, type?, grade?, subtitle?, blocks? } — 교재 수정. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) set.title = body.title.trim().slice(0, 160);
  if (isMaterialType(body.type)) set.type = body.type;
  if (typeof body.grade === 'string') set.grade = body.grade.trim().slice(0, 40);
  if (typeof body.subtitle === 'string') set.subtitle = body.subtitle.trim().slice(0, 200);
  if (body.blocks !== undefined) set.blocks = sanitizeBlocks(body.blocks);

  const db = await getVipDb();
  await ensureMaterialIndexes(db);
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_MATERIALS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE — 교재 삭제. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_MATERIALS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
