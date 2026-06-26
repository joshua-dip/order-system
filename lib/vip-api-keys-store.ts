import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';

/**
 * VIP 문제은행 외부 공개 API 키.
 * 키 → userId 매핑으로 /api/public/question-bank 에서 인증. 키는 사용자가 직접 발급/폐기.
 */
export const VIP_API_KEYS_COLLECTION = 'vip_api_keys';

export interface VipApiKeyDoc {
  _id?: ObjectId;
  userId: ObjectId;
  key: string; // 전체 키 (qbk_...)
  label: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
}

/** 사용자당 최대 키 수. */
export const MAX_API_KEYS_PER_USER = 5;

/** API 키 호출(사용) 로그 — 외부에서 키로 호출할 때마다 1건 기록. */
export const VIP_API_KEY_USAGE_COLLECTION = 'vip_api_key_usage';

export interface VipApiKeyUsageDoc {
  _id?: ObjectId;
  userId: ObjectId;
  keyId: ObjectId;
  keyLabel: string; // 표시용 스냅샷
  at: Date;
  endpoint: string; // 'question-bank'
  folder?: string;
  type?: string;
  limit?: number;
  offset?: number;
  count: number; // 반환 문항 수
  status: number; // HTTP status
  ip?: string;
  userAgent?: string;
  // 추가 수집 정보
  referer?: string; // 호출한 페이지(referer)
  origin?: string; // CORS origin
  acceptLanguage?: string; // 클라이언트 언어
  country?: string; // IP 기반 국가(best-effort)
  city?: string; // IP 기반 도시(best-effort)
  responseMs?: number; // 처리 시간(ms)
  bytes?: number; // 응답 크기(byte)
}

/** 사설/로컬 IP 는 지오 조회 생략. */
function isPrivateIp(ip: string): boolean {
  return !ip || ip === '::1' || ip === 'localhost' || ip.startsWith('127.') || ip.startsWith('10.') ||
    ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith('fc') || ip.startsWith('fd');
}

const GEO_CACHE = new Map<string, { country?: string; city?: string }>();

/** IP → 국가·도시 (무료 공개 API ipwho.is, 키 없음, 캐시·타임아웃·실패무시). */
export async function lookupGeo(ip: string): Promise<{ country?: string; city?: string }> {
  if (isPrivateIp(ip)) return {};
  const cached = GEO_CACHE.get(ip);
  if (cached) return cached;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,city`, { signal: ctrl.signal });
    clearTimeout(t);
    const d = (await r.json()) as { success?: boolean; country?: string; city?: string };
    const out = d?.success ? { country: d.country || undefined, city: d.city || undefined } : {};
    if (GEO_CACHE.size > 1000) GEO_CACHE.clear();
    GEO_CACHE.set(ip, out);
    return out;
  } catch {
    return {};
  }
}

/** 로그 보존 기간(초) — 1년 후 자동 만료. */
const USAGE_TTL_SECONDS = 365 * 24 * 60 * 60;

let _indexed = false;
export async function ensureApiKeyIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_API_KEYS_COLLECTION).createIndex({ key: 1 }, { unique: true }),
    db.collection(VIP_API_KEYS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(VIP_API_KEY_USAGE_COLLECTION).createIndex({ userId: 1, at: -1 }),
    db.collection(VIP_API_KEY_USAGE_COLLECTION).createIndex({ keyId: 1, at: -1 }),
    db.collection(VIP_API_KEY_USAGE_COLLECTION).createIndex({ at: 1 }, { expireAfterSeconds: USAGE_TTL_SECONDS }),
  ]);
}

/** 한 번의 외부 API 호출을 사용 로그에 기록 (best-effort — 실패해도 응답엔 영향 없음). */
export async function recordApiKeyUsage(db: Db, doc: Omit<VipApiKeyUsageDoc, '_id'>): Promise<void> {
  try {
    await db.collection(VIP_API_KEY_USAGE_COLLECTION).insertOne(doc);
  } catch {
    /* 로그 기록 실패는 무시 */
  }
}

/** 새 키 — `qbk_` + 48 hex. */
export function generateApiKey(): string {
  return `qbk_${randomBytes(24).toString('hex')}`;
}

/** 표시용 마스킹: qbk_ab12cd…(뒤 4자리). */
export function maskApiKey(key: string): string {
  if (key.length <= 14) return key;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}
