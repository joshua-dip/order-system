import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

/** 비회원 /variant 남용 차단 목록 컬렉션 */
export const GUEST_VARIANT_BLOCKLIST_COLLECTION = 'guest_variant_blocklist';

export type BlocklistKind = 'ip_hash' | 'api_key_hint';

export type BlocklistDoc = {
  _id: ObjectId;
  kind: BlocklistKind;
  value: string;
  reason?: string;
  created_at: Date;
  created_by?: string;
};

let indexEnsured = false;
async function ensureIndexes() {
  if (indexEnsured) return;
  try {
    const db = await getDb('gomijoshua');
    await db
      .collection(GUEST_VARIANT_BLOCKLIST_COLLECTION)
      .createIndex({ kind: 1, value: 1 }, { unique: true });
    indexEnsured = true;
  } catch {
    indexEnsured = true;
  }
}

/** generate 엔드포인트에서 빠른 in-memory 캐시로 조회 */
type Cache = {
  ipHashSet: Set<string>;
  apiKeyHintSet: Set<string>;
  loadedAt: number;
};
const CACHE: Cache = { ipHashSet: new Set(), apiKeyHintSet: new Set(), loadedAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function loadCache(force = false) {
  const now = Date.now();
  if (!force && CACHE.loadedAt && now - CACHE.loadedAt < CACHE_TTL_MS) return;
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  const rows = await db
    .collection(GUEST_VARIANT_BLOCKLIST_COLLECTION)
    .find({}, { projection: { kind: 1, value: 1 } })
    .toArray();
  const ip = new Set<string>();
  const key = new Set<string>();
  for (const r of rows as unknown as { kind?: string; value?: unknown }[]) {
    const k = r.kind;
    const v = typeof r.value === 'string' ? r.value : '';
    if (!v) continue;
    if (k === 'ip_hash') ip.add(v);
    else if (k === 'api_key_hint') key.add(v);
  }
  CACHE.ipHashSet = ip;
  CACHE.apiKeyHintSet = key;
  CACHE.loadedAt = now;
}

export function invalidateBlocklistCache() {
  CACHE.loadedAt = 0;
}

export async function isGuestRequestBlocked(params: {
  ipHash?: string | null;
  apiKeyHint?: string | null;
}): Promise<{ blocked: boolean; reason?: string }> {
  try {
    await loadCache(false);
  } catch {
    return { blocked: false };
  }
  if (params.ipHash && CACHE.ipHashSet.has(params.ipHash)) {
    return { blocked: true, reason: 'ip' };
  }
  if (params.apiKeyHint && CACHE.apiKeyHintSet.has(params.apiKeyHint)) {
    return { blocked: true, reason: 'api_key' };
  }
  return { blocked: false };
}

export async function addBlocklistEntry(entry: {
  kind: BlocklistKind;
  value: string;
  reason?: string;
  created_by?: string;
}): Promise<{ ok: boolean; error?: string; _id?: string }> {
  const value = (entry.value || '').trim();
  if (!value) return { ok: false, error: 'value 필수' };
  if (entry.kind !== 'ip_hash' && entry.kind !== 'api_key_hint') {
    return { ok: false, error: '지원하지 않는 kind' };
  }
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  try {
    const r = await db.collection(GUEST_VARIANT_BLOCKLIST_COLLECTION).insertOne({
      kind: entry.kind,
      value,
      reason: (entry.reason || '').trim() || undefined,
      created_at: new Date(),
      created_by: entry.created_by || undefined,
    });
    invalidateBlocklistCache();
    return { ok: true, _id: String(r.insertedId) };
  } catch (e) {
    const msg = (e as Error)?.message || '';
    if (/duplicate key/i.test(msg)) {
      return { ok: false, error: '이미 차단 목록에 있습니다.' };
    }
    return { ok: false, error: msg || '차단 등록 실패' };
  }
}

export async function removeBlocklistEntry(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!ObjectId.isValid(id)) return { ok: false, error: '유효하지 않은 id' };
  const db = await getDb('gomijoshua');
  const r = await db
    .collection(GUEST_VARIANT_BLOCKLIST_COLLECTION)
    .deleteOne({ _id: new ObjectId(id) });
  invalidateBlocklistCache();
  return r.deletedCount > 0 ? { ok: true } : { ok: false, error: '이미 삭제됨' };
}

export async function listBlocklist(): Promise<BlocklistDoc[]> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  const rows = await db
    .collection(GUEST_VARIANT_BLOCKLIST_COLLECTION)
    .find({})
    .sort({ created_at: -1 })
    .limit(500)
    .toArray();
  return rows as unknown as BlocklistDoc[];
}
