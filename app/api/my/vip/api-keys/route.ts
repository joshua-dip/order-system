import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import {
  VIP_API_KEYS_COLLECTION,
  ensureApiKeyIndexes,
  generateApiKey,
  MAX_API_KEYS_PER_USER,
  type VipApiKeyDoc,
} from '@/lib/vip-api-keys-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(d: VipApiKeyDoc) {
  return {
    id: String(d._id),
    key: d.key,
    label: d.label,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt ?? null,
  };
}

/** GET — 내 API 키 목록 (전체 키 포함 — 본인 세션 인증) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'qbank-api');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  await ensureApiKeyIndexes(db);
  const userId = new ObjectId(auth.userId);
  const keys = await db.collection<VipApiKeyDoc>(VIP_API_KEYS_COLLECTION)
    .find({ userId }).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ ok: true, keys: keys.map(view), max: MAX_API_KEYS_PER_USER });
}

/** POST — 새 키 발급 ({ label? }) */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'qbank-api');
  if (auth instanceof NextResponse) return auth;
  let body: { label?: unknown } = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { /* label 없이 발급 허용 */ }
  const label = (typeof body.label === 'string' ? body.label : '').trim().slice(0, 40) || '기본 키';

  const db = await getDb('gomijoshua');
  await ensureApiKeyIndexes(db);
  const userId = new ObjectId(auth.userId);

  const count = await db.collection(VIP_API_KEYS_COLLECTION).countDocuments({ userId });
  if (count >= MAX_API_KEYS_PER_USER) {
    return NextResponse.json({ error: `키는 최대 ${MAX_API_KEYS_PER_USER}개까지 발급할 수 있습니다.` }, { status: 400 });
  }

  const doc: VipApiKeyDoc = { userId, key: generateApiKey(), label, createdAt: new Date(), lastUsedAt: null };
  const r = await db.collection(VIP_API_KEYS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, key: view({ ...doc, _id: r.insertedId }) }, { status: 201 });
}

/** DELETE — 키 폐기 (?id=) */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'qbank-api');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const r = await db.collection(VIP_API_KEYS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
