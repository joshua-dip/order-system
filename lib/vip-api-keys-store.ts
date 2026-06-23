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
