import { ObjectId, type Db } from 'mongodb';
import type { WordItem } from './word-types';

/**
 * VIP 단어 관리 — 선생님이 단어장(단어·뜻·예문)을 만들어 강좌/단원별로 정리하고, 단어장·단어시험지로 인쇄.
 * 콘텐츠는 직접 작성(무과금).
 */
export const VIP_WORD_SETS_COLLECTION = 'vip_word_sets';

export interface VipWordSet {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  folder: string; // 강좌/단원 ('' = 미분류)
  textbook?: string; // 연계 교재(선택)
  words: WordItem[];
  createdAt: Date;
  updatedAt?: Date;
}

const MAX_WORDS = 1000;

/** 들어온 words 배열 검증·정리. */
export function sanitizeWords(raw: unknown): WordItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WordItem[] = [];
  for (const item of raw.slice(0, MAX_WORDS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const w = (typeof r.w === 'string' ? r.w : '').trim().slice(0, 120);
    if (!w) continue;
    const m = (typeof r.m === 'string' ? r.m : '').trim().slice(0, 300);
    const ex = typeof r.ex === 'string' ? r.ex.trim().slice(0, 400) : '';
    out.push(ex ? { w, m, ex } : { w, m });
  }
  return out;
}

let _indexed = false;
export async function ensureWordSetIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_WORD_SETS_COLLECTION).createIndex({ userId: 1, updatedAt: -1, createdAt: -1 }),
    db.collection(VIP_WORD_SETS_COLLECTION).createIndex({ userId: 1, folder: 1 }),
  ]);
}
