import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '@/lib/variant-draft-grammar-rules';

export type SaveGeneratedQuestionInput = {
  passage_id: string;
  textbook: string;
  source: string;
  type: string;
  question_data: Record<string, unknown>;
  status?: string;
  option_type?: string;
  difficulty?: string;
};

export type SaveGeneratedQuestionResult =
  | {
      ok: true;
      inserted_id: string;
      textbook: string;
      passage_id: string;
      source: string;
      type: string;
      status: string;
    }
  | { ok: false; error: string };

/**
 * 관리자·MCP·CLI 공통: generated_questions에 한 건 삽입.
 */
export async function saveGeneratedQuestionToDb(
  input: SaveGeneratedQuestionInput
): Promise<SaveGeneratedQuestionResult> {
  const passageIdStr = input.passage_id.trim();
  const textbook = input.textbook.trim();
  const source = input.source.trim();
  const type = input.type.trim();
  const option_type = (input.option_type ?? 'English').trim() || 'English';
  const docStatus = (input.status ?? '대기').trim() || '대기';

  if (!textbook || !passageIdStr || !ObjectId.isValid(passageIdStr)) {
    return { ok: false, error: '교재명과 유효한 passage_id가 필요합니다.' };
  }
  if (!source || !type) {
    return { ok: false, error: 'source와 type은 필수입니다.' };
  }

  let question_data = { ...input.question_data };
  if (type === '어법') {
    question_data = { ...question_data, Options: GRAMMAR_VARIANT_OPTIONS_FIXED };
  }

  const now = new Date();
  const difficulty = type === '삽입-고난도'
    ? '상'
    : ((input.difficulty ?? input.question_data?.DifficultyLevel as string | undefined ?? '중').trim() || '중');

  const doc = {
    textbook,
    passage_id: new ObjectId(passageIdStr),
    source,
    type,
    option_type,
    difficulty,
    question_data,
    status: docStatus,
    error_msg: null as string | null,
    created_at: now,
    updated_at: now,
  };

  const db = await getDb('gomijoshua');
  const r = await db.collection('generated_questions').insertOne(doc);
  return {
    ok: true,
    inserted_id: String(r.insertedId),
    textbook,
    passage_id: passageIdStr,
    source,
    type,
    status: docStatus,
  };
}
