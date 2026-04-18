import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { DetectedPassage } from '@/lib/passage-source-detect';

/** 비회원 /variant 생성 로그 컬렉션명 */
export const GUEST_GENERATED_QUESTIONS_COLLECTION = 'guest_generated_questions';

/** paragraph 저장 상한 (긴 학습자료/전체 페이지 덤프 방지) */
export const GUEST_PARAGRAPH_MAX_LEN = 8_000;

/** 중복 저장 억제 — 같은 ip_hash + paragraph_hash + type 가 이 시간 안에 오면 무시 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

export type GuestGeneratedQuestionStatus = 'matched' | 'unknown';

export type SaveGuestGeneratedInput = {
  paragraph: string;
  type: string;
  difficulty?: string;
  question_data: Record<string, unknown>;
  detected: DetectedPassage | null;
  ip?: string | null;
  userAgent?: string | null;
  apiKeyHint?: string | null;
  claudeModel?: string | null;
};

export type GuestGeneratedQuestionDoc = {
  _id: ObjectId;
  created_at: Date;
  updated_at?: Date;
  type: string;
  difficulty: string;
  question_data: Record<string, unknown>;
  input_paragraph: string;
  paragraph_hash: string;
  paragraph_length: number;
  match_status: GuestGeneratedQuestionStatus;
  match_kind?: 'head' | 'mid';
  passage_id?: ObjectId;
  textbook?: string;
  chapter?: string;
  number?: string;
  source_key?: string;
  source?: string;
  ip_hash?: string;
  user_agent?: string;
  api_key_hint?: string;
  claude_model?: string;
  tags?: string[];
  note?: string;
  archived?: boolean;
  promoted_to?: ObjectId;
  promoted_at?: Date;
  promoted_by?: string;
  reviewed_by?: string;
  reviewed_at?: Date;
};

function salt(): string {
  return process.env.GUEST_LOG_SALT || 'next-order-guest-log';
}

/** IP 해시 — 원본 저장 금지. 앞 16자만 사용해 충돌은 있지만 대역 식별엔 충분. */
export function hashIp(ip: string | null | undefined): string {
  const raw = (ip || '').split(',')[0].trim();
  if (!raw) return '';
  return createHash('sha256').update(raw + '::' + salt()).digest('hex').slice(0, 16);
}

/** paragraph 중복 키 — 본문 기반 해시(앞 2KB) */
export function hashParagraph(paragraph: string): string {
  const s = (paragraph || '').slice(0, 2048);
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

/**
 * 비회원 생성 문제 저장. 실패해도 throw 하지 않고 false 리턴.
 * - paragraph 길이 자름
 * - 동일 ip_hash + paragraph_hash + type 가 DEDUP_WINDOW_MS 내에 있으면 skip
 */
export async function saveGuestGeneratedQuestion(
  input: SaveGuestGeneratedInput,
): Promise<{ ok: boolean; inserted_id?: string; skipped?: 'dedup' | 'empty' | 'error' }> {
  try {
    const paragraph = (input.paragraph || '').slice(0, GUEST_PARAGRAPH_MAX_LEN);
    if (!paragraph.trim() || !input.type.trim()) {
      return { ok: false, skipped: 'empty' };
    }

    const paragraph_hash = hashParagraph(paragraph);
    const ip_hash = hashIp(input.ip);
    const now = new Date();

    const db = await getDb('gomijoshua');
    const col = db.collection<GuestGeneratedQuestionDoc>(GUEST_GENERATED_QUESTIONS_COLLECTION);

    if (ip_hash) {
      const since = new Date(now.getTime() - DEDUP_WINDOW_MS);
      const dup = await col.findOne(
        {
          ip_hash,
          paragraph_hash,
          type: input.type,
          created_at: { $gte: since },
        },
        { projection: { _id: 1 } },
      );
      if (dup) return { ok: false, skipped: 'dedup' };
    }

    const matched = input.detected != null;
    const doc: Omit<GuestGeneratedQuestionDoc, '_id'> = {
      created_at: now,
      type: input.type,
      difficulty: (input.difficulty || '중').trim() || '중',
      question_data: input.question_data,
      input_paragraph: paragraph,
      paragraph_hash,
      paragraph_length: paragraph.length,
      match_status: matched ? 'matched' : 'unknown',
      ...(matched && input.detected
        ? {
            match_kind: input.detected.match_kind,
            passage_id: ObjectId.isValid(input.detected.passage_id)
              ? new ObjectId(input.detected.passage_id)
              : undefined,
            textbook: input.detected.textbook || undefined,
            chapter: input.detected.chapter || undefined,
            number: input.detected.number || undefined,
            source_key: input.detected.source_key || undefined,
            source: input.detected.source_label || undefined,
          }
        : {}),
      ...(ip_hash ? { ip_hash } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent.slice(0, 300) } : {}),
      ...(input.apiKeyHint ? { api_key_hint: input.apiKeyHint.slice(0, 24) } : {}),
      ...(input.claudeModel ? { claude_model: input.claudeModel.slice(0, 80) } : {}),
    };

    const r = await col.insertOne(doc as GuestGeneratedQuestionDoc);
    return { ok: true, inserted_id: String(r.insertedId) };
  } catch (e) {
    console.error('saveGuestGeneratedQuestion:', e);
    return { ok: false, skipped: 'error' };
  }
}

/**
 * 컬렉션 인덱스 보장 — lazy 하게 처음 쓰기 전 한 번만 실행.
 */
let indexEnsured = false;
export async function ensureGuestGeneratedIndexes(): Promise<void> {
  if (indexEnsured) return;
  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(GUEST_GENERATED_QUESTIONS_COLLECTION);
    await Promise.all([
      col.createIndex({ created_at: -1 }),
      col.createIndex({ match_status: 1, created_at: -1 }),
      col.createIndex({ passage_id: 1, type: 1 }),
      col.createIndex({ ip_hash: 1, paragraph_hash: 1, type: 1, created_at: -1 }),
      col.createIndex({ paragraph_hash: 1 }),
      col.createIndex({ type: 1, match_status: 1 }),
      col.createIndex({ archived: 1 }),
    ]);
    indexEnsured = true;
  } catch (e) {
    console.error('ensureGuestGeneratedIndexes:', e);
  }
}
