import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_INVENTORY_COLLECTION,
  ensureInventoryIndexes,
  type VipInventoryItem,
} from '@/lib/vip-inventory-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(it: VipInventoryItem) {
  const quantity = Number(it.quantity ?? 0);
  const minQuantity = Number(it.minQuantity ?? 0);
  return {
    id: String(it._id),
    name: it.name,
    category: it.category ?? '',
    quantity,
    unit: it.unit ?? '',
    minQuantity,
    location: it.location ?? '',
    note: it.note ?? '',
    lowStock: minQuantity > 0 && quantity <= minQuantity,
    createdAt: it.createdAt,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** GET ?category= &q= — 재고 목록 + 분류 집계 + 요약(부족 품목 수). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'inventory');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureInventoryIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const category = sp.get('category');
  if (category) filter.category = category;
  const q = sp.get('q');
  if (q && q.trim()) filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };

  const list = await db
    .collection<VipInventoryItem>(VIP_INVENTORY_COLLECTION)
    .find(filter)
    .sort({ name: 1 })
    .limit(500)
    .toArray();

  const categories = await db
    .collection<VipInventoryItem>(VIP_INVENTORY_COLLECTION)
    .aggregate([
      { $match: { userId: uid } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $project: { _id: 0, name: '$_id', count: 1 } },
      { $sort: { name: 1 } },
    ])
    .toArray();

  const lowStock = await db.collection(VIP_INVENTORY_COLLECTION).countDocuments({
    userId: uid,
    $expr: { $and: [{ $gt: ['$minQuantity', 0] }, { $lte: ['$quantity', '$minQuantity'] }] },
  });

  return NextResponse.json({
    ok: true,
    items: list.map(view),
    categories: categories.filter((c) => c.name),
    summary: { lowStock },
  });
}

/** POST { name, category?, quantity?, unit?, minQuantity?, location?, note? } — 품목 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'inventory');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: '품목명을 입력하세요.' }, { status: 400 });

  const category = (typeof body.category === 'string' ? body.category : '').trim().slice(0, 40);
  const unit = (typeof body.unit === 'string' ? body.unit : '').trim().slice(0, 20);
  const location = (typeof body.location === 'string' ? body.location : '').trim().slice(0, 80);
  const note = (typeof body.note === 'string' ? body.note : '').trim().slice(0, 500);
  const quantity = toNonNegInt(body.quantity);
  const minQuantity = toNonNegInt(body.minQuantity);

  const db = await getVipDb();
  await ensureInventoryIndexes(db);
  const uid = new ObjectId(auth.userId);
  const now = new Date();

  const doc: VipInventoryItem = {
    userId: uid, name, category, quantity, unit, minQuantity, location, note,
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection(VIP_INVENTORY_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { name?, category?, quantity?, unit?, minQuantity?, location?, note? } 또는 { delta:N } — 수정 / 수량 증감. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'inventory');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  // 수량 증감 — 0 미만으로 내려가지 않도록 aggregation pipeline update($max) 사용.
  if (body.delta !== undefined && body.delta !== null) {
    const delta = Number(body.delta);
    if (!Number.isFinite(delta)) return NextResponse.json({ error: 'delta 가 올바르지 않습니다.' }, { status: 400 });
    const r = await db.collection(VIP_INVENTORY_COLLECTION).updateOne(
      { _id: new ObjectId(id), userId: uid },
      [{ $set: { quantity: { $max: [0, { $add: ['$quantity', delta] }] }, updatedAt: new Date() } }],
    );
    if (r.matchedCount === 0) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === 'string' && body.name.trim()) set.name = body.name.trim().slice(0, 120);
  if (typeof body.category === 'string') set.category = body.category.trim().slice(0, 40);
  if (typeof body.unit === 'string') set.unit = body.unit.trim().slice(0, 20);
  if (typeof body.location === 'string') set.location = body.location.trim().slice(0, 80);
  if (typeof body.note === 'string') set.note = body.note.trim().slice(0, 500);
  if (body.quantity !== undefined) set.quantity = toNonNegInt(body.quantity);
  if (body.minQuantity !== undefined) set.minQuantity = toNonNegInt(body.minQuantity);

  const r = await db.collection(VIP_INVENTORY_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'inventory');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_INVENTORY_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
