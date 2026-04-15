import { createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '@/lib/variant-draft-grammar-rules';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

export const MEMBER_PASSAGES_COLLECTION = 'member_passages';
export const MEMBER_GENERATED_QUESTIONS_COLLECTION = 'member_generated_questions';

const INSERTION_OPTIONS_FIXED = '①\n②\n③\n④\n⑤';
const IRRELEVANT_OPTIONS_FIXED = '① ### ② ### ③ ### ④ ### ⑤';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * 동일 회원·동일 지문 본문이면 기존 passage 문서 재사용.
 */
export async function findOrCreateMemberPassage(input: {
  ownerUserId: ObjectId;
  ownerPhone: string;
  textbook: string;
  source: string;
  paragraph: string;
}): Promise<{ passage_id: ObjectId }> {
  const db = await getDb('gomijoshua');
  const col = db.collection(MEMBER_PASSAGES_COLLECTION);
  const paragraph = input.paragraph.trim();
  const textbook = input.textbook.trim() || '회원지문';
  const source = input.source.trim() || '직접입력';
  const contentSha256 = sha256Hex(paragraph);
  const phone = normalizePhone(input.ownerPhone);

  const existing = await col.findOne({
    ownerUserId: input.ownerUserId,
    contentSha256,
  });
  if (existing?._id) {
    return { passage_id: existing._id as ObjectId };
  }

  const now = new Date();
  const ins = await col.insertOne({
    ownerUserId: input.ownerUserId,
    ownerPhone: phone,
    textbook,
    source,
    contentSha256,
    content: { original: paragraph },
    memberUpload: true,
    created_at: now,
    updated_at: now,
  });
  return { passage_id: ins.insertedId };
}

export async function getNextMemberQuestionNum(input: {
  passage_id: ObjectId;
  source: string;
  type: string;
}): Promise<number> {
  const db = await getDb('gomijoshua');
  const col = db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION);
  const source = input.source.trim();
  const type = input.type.trim();
  const agg = await col
    .aggregate<{ m: number | null }>([
      { $match: { passage_id: input.passage_id, source, type } },
      { $group: { _id: null, m: { $max: '$question_data.NumQuestion' } } },
    ])
    .toArray();
  const prevMax = typeof agg[0]?.m === 'number' && Number.isFinite(agg[0].m) ? agg[0].m : 0;
  return prevMax + 1;
}

export type InsertMemberGeneratedQuestionInput = {
  ownerUserId: ObjectId;
  ownerPhone: string;
  passage_id: ObjectId;
  textbook: string;
  source: string;
  type: string;
  question_data: Record<string, unknown>;
  status?: string;
  option_type?: string;
  difficulty?: string;
};

/**
 * generated_questions와 동일 필드 + ownerUserId, ownerPhone, createdBy
 */
export async function insertMemberGeneratedQuestion(
  input: InsertMemberGeneratedQuestionInput
): Promise<{ ok: true; inserted_id: string } | { ok: false; error: string }> {
  const textbook = input.textbook.trim() || '회원지문';
  const source = normalizeMockVariantSourceLabel(textbook, input.source.trim() || '직접입력');
  const type = input.type.trim();
  const option_type = (input.option_type ?? 'English').trim() || 'English';
  const docStatus = (input.status ?? '대기').trim() || '대기';
  const phone = normalizePhone(input.ownerPhone);

  if (!type || !input.passage_id) {
    return { ok: false, error: '유형과 passage가 필요합니다.' };
  }

  let question_data = { ...input.question_data };
  if (type === '어법') {
    question_data = { ...question_data, Options: GRAMMAR_VARIANT_OPTIONS_FIXED };
  }
  if (type === '삽입' || type === '삽입-고난도') {
    question_data = { ...question_data, Options: INSERTION_OPTIONS_FIXED };
  }
  if (type === '무관한문장') {
    const rawOpts = typeof question_data.Options === 'string' ? question_data.Options : '';
    if (!rawOpts.trim() || /[①②③④⑤]\s+[①②③④⑤]/.test(rawOpts)) {
      question_data = { ...question_data, Options: IRRELEVANT_OPTIONS_FIXED };
    }
  }
  if (typeof question_data.Source === 'string' && question_data.Source.trim()) {
    question_data = {
      ...question_data,
      Source: normalizeMockVariantSourceLabel(textbook, question_data.Source.trim()),
    };
  }

  const now = new Date();
  const difficulty =
    type === '삽입-고난도'
      ? '상'
      : ((input.difficulty ?? (question_data.DifficultyLevel as string | undefined) ?? '중').trim() || '중');

  const doc = {
    textbook,
    passage_id: input.passage_id,
    source,
    type,
    option_type,
    difficulty,
    question_data,
    status: docStatus,
    error_msg: null as string | null,
    created_at: now,
    updated_at: now,
    ownerUserId: input.ownerUserId,
    ownerPhone: phone,
    createdBy: 'member_byok' as const,
  };

  const db = await getDb('gomijoshua');
  const r = await db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION).insertOne(doc);
  return { ok: true, inserted_id: String(r.insertedId) };
}

export async function assertMemberOwnsPassage(
  ownerUserId: ObjectId,
  passage_id: ObjectId
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  const row = await db.collection(MEMBER_PASSAGES_COLLECTION).findOne(
    { _id: passage_id, ownerUserId },
    { projection: { _id: 1 } },
  );
  return !!row;
}
