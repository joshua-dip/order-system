import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_PASSAGE_ANALYSES_COLLECTION,
  ensurePassageAnalysisIndexes,
  normalizeSentences,
  normalizeVocab,
  analysisListView,
  analysisFullView,
  type VipPassageAnalysis,
} from '@/lib/vip-passage-analysis-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MENU = 'passage-analysis';

/** GET — ?id= 면 상세(편집용), 없으면 목록(요약). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, MENU);
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensurePassageAnalysisIndexes(db);
  const uid = new ObjectId(auth.userId);
  const id = request.nextUrl.searchParams.get('id');

  if (id) {
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'id 형식 오류' }, { status: 400 });
    const doc = await db.collection<VipPassageAnalysis>(VIP_PASSAGE_ANALYSES_COLLECTION).findOne({ _id: new ObjectId(id), userId: uid });
    if (!doc) return NextResponse.json({ error: '분석을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true, analysis: analysisFullView(doc) });
  }

  const list = await db
    .collection<VipPassageAnalysis>(VIP_PASSAGE_ANALYSES_COLLECTION)
    .find({ userId: uid })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(300)
    .toArray();
  return NextResponse.json({ ok: true, analyses: list.map(analysisListView) });
}

function parseBody(body: Record<string, unknown>) {
  return {
    title: (typeof body.title === 'string' ? body.title : '').trim().slice(0, 120),
    source: (typeof body.source === 'string' ? body.source : '').trim().slice(0, 120),
    passageId: typeof body.passageId === 'string' ? body.passageId.slice(0, 64) : '',
    sentences: normalizeSentences(body.sentences),
    vocab: normalizeVocab(body.vocab),
    grammarNote: (typeof body.grammarNote === 'string' ? body.grammarNote : '').slice(0, 4000),
    summary: (typeof body.summary === 'string' ? body.summary : '').slice(0, 2000),
  };
}

/** POST — 새 분석 저장. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, MENU);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const p = parseBody(body);
  if (!p.title && p.sentences.length === 0) {
    return NextResponse.json({ error: '제목 또는 문장을 입력하세요.' }, { status: 400 });
  }
  const db = await getVipDb();
  await ensurePassageAnalysisIndexes(db);
  const now = new Date();
  const doc: VipPassageAnalysis = {
    userId: new ObjectId(auth.userId),
    title: p.title || '제목 없음',
    source: p.source,
    ...(p.passageId ? { passageId: p.passageId } : {}),
    sentences: p.sentences,
    vocab: p.vocab,
    grammarNote: p.grammarNote,
    summary: p.summary,
    createdAt: now,
    updatedAt: now,
  };
  const r = await db.collection(VIP_PASSAGE_ANALYSES_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, MENU);
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const p = parseBody(body);
  const set: Record<string, unknown> = {
    title: p.title || '제목 없음',
    source: p.source,
    passageId: p.passageId,
    sentences: p.sentences,
    vocab: p.vocab,
    grammarNote: p.grammarNote,
    summary: p.summary,
    updatedAt: new Date(),
  };
  const db = await getVipDb();
  const r = await db.collection(VIP_PASSAGE_ANALYSES_COLLECTION).updateOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '분석을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, MENU);
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const r = await db.collection(VIP_PASSAGE_ANALYSES_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (r.deletedCount === 0) return NextResponse.json({ error: '분석을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
