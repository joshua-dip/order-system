import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import { VIP_FORMS_COLLECTION, ensureFormIndexes, type VipForm } from '@/lib/vip-form-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(f: VipForm) {
  return {
    id: String(f._id),
    title: f.title,
    category: f.category ?? '',
    content: f.content ?? '',
    createdAt: f.createdAt,
    updatedAt: f.updatedAt ?? null,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET ?category= &q= — 양식 목록 + 분류(폴더) 집계. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'forms');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureFormIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const category = sp.get('category');
  if (category) filter.category = category;
  const q = (sp.get('q') ?? '').trim();
  if (q) filter.title = { $regex: escapeRegex(q), $options: 'i' };

  const list = await db
    .collection<VipForm>(VIP_FORMS_COLLECTION)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(300)
    .toArray();

  const catAgg = await db
    .collection(VIP_FORMS_COLLECTION)
    .aggregate([
      { $match: { userId: uid } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  const categories = catAgg.map((c) => ({ name: String(c._id ?? ''), count: c.count as number }));

  return NextResponse.json({ ok: true, forms: list.map(view), categories });
}

/** POST { title, category?, content? } — 양식 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'forms');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
  const category = (typeof body.category === 'string' ? body.category : '').trim().slice(0, 40);
  const content = (typeof body.content === 'string' ? body.content : '').slice(0, 20000);

  const db = await getVipDb();
  await ensureFormIndexes(db);
  const uid = new ObjectId(auth.userId);
  const now = new Date();
  const doc: VipForm = { userId: uid, title, category, content, createdAt: now, updatedAt: now };
  const r = await db.collection(VIP_FORMS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId), form: view({ ...doc, _id: r.insertedId }) }, { status: 201 });
}

/** PATCH ?id= { title?, category?, content? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'forms');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') {
    const t = body.title.trim().slice(0, 160);
    if (!t) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
    set.title = t;
  }
  if (typeof body.category === 'string') set.category = body.category.trim().slice(0, 40);
  if (typeof body.content === 'string') set.content = body.content.slice(0, 20000);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_FORMS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '양식을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'forms');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_FORMS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
