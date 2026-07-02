import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION, sanitizeStudioPages } from '@/lib/vip-material-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadOwned(request: NextRequest, id: string) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return { err: auth };
  if (!ObjectId.isValid(id)) return { err: NextResponse.json({ error: '유효하지 않은 ID' }, { status: 400 }) };
  const db = await getDb('gomijoshua');
  const doc = await db.collection(STUDIO_MATERIALS_COLLECTION).findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!doc) return { err: NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 }) };
  return { db, doc, auth };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadOwned(request, id);
  if ('err' in r) return r.err;
  const { doc } = r;
  return NextResponse.json({
    ok: true,
    doc: {
      id: String(doc._id),
      title: doc.title ?? '',
      subtitle: doc.subtitle ?? '',
      difficulty: doc.difficulty ?? '',
      pages: Array.isArray(doc.pages) ? doc.pages : [],
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : null,
    },
  });
}

/** PATCH { title?, subtitle?, difficulty?, pages? } — 저장(자동저장) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadOwned(request, id);
  if ('err' in r) return r.err;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') set.title = body.title.trim().slice(0, 120);
  if (typeof body.subtitle === 'string') set.subtitle = body.subtitle.trim().slice(0, 200);
  if (typeof body.difficulty === 'string') set.difficulty = body.difficulty.trim().slice(0, 20);
  if (body.pages !== undefined) {
    const pages = sanitizeStudioPages(body.pages);
    set.pages = pages;
    set.pageCount = pages.length;
  }
  await r.db.collection(STUDIO_MATERIALS_COLLECTION).updateOne({ _id: r.doc._id }, { $set: set });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadOwned(request, id);
  if ('err' in r) return r.err;
  await r.db.collection(STUDIO_MATERIALS_COLLECTION).deleteOne({ _id: r.doc._id });
  return NextResponse.json({ ok: true });
}
