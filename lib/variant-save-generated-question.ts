import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '@/lib/variant-draft-grammar-rules';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

/** 삽입·삽입-고난도 유형: Options는 위치 번호만 */
const INSERTION_OPTIONS_FIXED = '①\n②\n③\n④\n⑤';
/** 무관한문장 유형: Options 표준값 (### 구분) */
const IRRELEVANT_OPTIONS_FIXED = '① ### ② ### ③ ### ④ ### ⑤';

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
  const source = normalizeMockVariantSourceLabel(textbook, input.source.trim());
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
  // 삽입·삽입-고난도·무관한문장: Options는 위치 번호만(①~⑤). AI가 "① ①" 식으로 중복 생성하는 버그 방지.
  if (type === '삽입' || type === '삽입-고난도') {
    question_data = { ...question_data, Options: INSERTION_OPTIONS_FIXED };
  }
  if (type === '무관한문장') {
    const rawOpts = typeof question_data.Options === 'string' ? question_data.Options : '';
    // 중복 번호 패턴(예: "① ①") 또는 비어 있으면 표준값으로 교체
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
