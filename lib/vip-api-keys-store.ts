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

let _indexed = false;
export async function ensureApiKeyIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_API_KEYS_COLLECTION).createIndex({ key: 1 }, { unique: true }),
    db.collection(VIP_API_KEYS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }),
  ]);
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
