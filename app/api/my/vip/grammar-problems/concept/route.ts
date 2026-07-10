import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_CONCEPTS_COLLECTION, normalizeConcept } from '@/lib/vip-grammar-concept';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  ?topicKey=... → 해당 진도 개념 1건 (없으면 concept:null)
 * GET  ?list=1       → 개념이 있는 topicKey 목록(배지용)
 * PUT  body { topicKey, title, intro, points[], tip } → upsert (빈 개념이면 삭제)
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_CONCEPTS_COLLECTION);
  const userId = new ObjectId(auth.userId);
  const sp = request.nextUrl.searchParams;

  if (sp.get('list')) {
    const rows = await col.find({ userId }).project({ topicKey: 1 }).toArray();
    return NextResponse.json({ ok: true, topicKeys: rows.map((r) => String(r.topicKey)) });
  }

  const topicKey = (sp.get('topicKey') ?? '').trim();
  if (!topicKey) return NextResponse.json({ ok: false, error: 'topicKey 필요' }, { status: 400 });
  const doc = await col.findOne({ userId, topicKey });
  return NextResponse.json({
    ok: true,
    concept: doc ? { topicKey, title: doc.title ?? '', intro: doc.intro ?? '', table: doc.table ?? null, points: Array.isArray(doc.points) ? doc.points : [], tip: doc.tip ?? '' } : null,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_CONCEPTS_COLLECTION);
  const userId = new ObjectId(auth.userId);

  const body = await request.json().catch(() => null);
  const topicKey = String(body?.topicKey ?? '').trim();
  if (!topicKey) return NextResponse.json({ ok: false, error: 'topicKey 필요' }, { status: 400 });

  const concept = normalizeConcept({ ...body, topicKey });
  if (!concept) {
    // 빈 개념 → 삭제
    await col.deleteOne({ userId, topicKey });
    return NextResponse.json({ ok: true, deleted: true });
  }
  const set: Record<string, unknown> = { userId, topicKey, title: concept.title, intro: concept.intro, points: concept.points, tip: concept.tip ?? '', updatedAt: new Date() };
  const update: Record<string, unknown> = { $set: set };
  if (concept.table) set.table = concept.table;
  else update.$unset = { table: '' };
  await col.updateOne({ userId, topicKey }, update, { upsert: true });
  return NextResponse.json({ ok: true });
}
