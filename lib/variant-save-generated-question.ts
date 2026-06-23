import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  GRAMMAR_HARD_CORRECT_ANSWER_PATTERN,
  GRAMMAR_HARD_VARIANT_OPTIONS_FIXED,
  GRAMMAR_VARIANT_OPTIONS_FIXED,
  normalizeGrammarHardCorrectAnswer,
} from '@/lib/variant-draft-grammar-rules';
import { isAdvancedVariantType } from '@/lib/variant-pricing';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';
import { enrichQuestionDataWithExplanationIfEmpty } from '@/lib/generated-question-explanation-fallback';
import { nextGeneratedSerial } from '@/lib/generated-question-serial';

/** 삽입·삽입-고난도 유형: Options는 위치 번호만 */
const INSERTION_OPTIONS_FIXED = '①\n②\n③\n④\n⑤';
/** 무관한문장 유형: Options 표준값 (### 구분) */
const IRRELEVANT_OPTIONS_FIXED = '① ### ② ### ③ ### ④ ### ⑤';

/**
 * 정답 번호 분포가 적용되는 유형.
 * Paragraph 내 위치·순열에 정답이 묶여 있지 않아 보기 순서를 무작위로 섞어도 의미가 유지되는 유형만 포함.
 * (어법·삽입·삽입-고난도·무관한문장·순서는 보기 번호가 본문 구조에 묶여 있어 제외)
 */
const SHUFFLABLE_TYPES = new Set([
  '주제',
  '제목',
  '주장',
  '일치',
  '불일치',
  '함의',
  '함의-고난도',
  '빈칸',
  '빈칸-고난도',
  '요약',
  '요약-고난도',
  '주제-고난도',
  '제목-고난도',
  '주장-고난도',
  '일치-고난도',
  '불일치-고난도',
]);

const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'] as const;

/**
 * 5개 보기를 무작위 순열로 재배치하고 CorrectAnswer·Explanation의 동그라미 번호 참조를
 * 새 인덱스로 함께 갱신한다. 보기 텍스트가 5개가 아니거나 CorrectAnswer가 ①~⑤가 아니면 원본 반환.
 * 동그라미 번호가 한 자리에 치우치는 현상 보정용. 저장 경로(saveGeneratedQuestionToDb)에서만 호출.
 */
export function shuffleQuestionDataForDistribution(
  qd: Record<string, unknown>
): Record<string, unknown> {
  const rawOpts = typeof qd.Options === 'string' ? qd.Options : '';
  const rawCorrect = typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer.trim() : '';
  const rawExplanation = typeof qd.Explanation === 'string' ? qd.Explanation : '';

  if (!rawOpts || !rawCorrect) return qd;

  const parts = rawOpts.split(/\s*###\s*/).map((s) => s.trim());
  if (parts.length !== 5) return qd;

  const stripped = parts.map((s) => s.replace(/^[①②③④⑤]\s*/, '').trim());
  if (stripped.some((s) => !s)) return qd;

  const correctIdx = CIRCLED_NUMS.indexOf(rawCorrect as (typeof CIRCLED_NUMS)[number]);
  if (correctIdx < 0) return qd;

  // Fisher-Yates shuffle
  const perm = [0, 1, 2, 3, 4];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // 셔플 결과가 항등 순열이면 한 번 더 굴려 변화 보장
  // (인덱스를 한 번만 계산해야 함 — 좌/우에서 Math.random()을 따로 호출하면
  //  서로 다른 칸을 가리켜 보기가 중복·누락되는 버그가 생긴다.)
  if (perm.every((v, i) => v === i)) {
    const j = Math.floor(Math.random() * 4) + 1;
    [perm[0], perm[j]] = [perm[j], perm[0]];
  }

  const newOpts = perm
    .map((srcIdx, newIdx) => `${CIRCLED_NUMS[newIdx]} ${stripped[srcIdx]}`)
    .join(' ### ');

  const oldToNew = new Array<number>(5).fill(0);
  perm.forEach((srcIdx, newIdx) => {
    oldToNew[srcIdx] = newIdx;
  });
  const newCorrect = CIRCLED_NUMS[oldToNew[correctIdx]];

  // Explanation 내 ①~⑤ 참조를 새 인덱스로 일괄 치환 (충돌 방지용 임시 마커 경유)
  const placeholders = ['', '', '', '', ''];
  let newExplanation = rawExplanation;
  for (let i = 0; i < 5; i++) {
    newExplanation = newExplanation.split(CIRCLED_NUMS[i]).join(placeholders[i]);
  }
  for (let i = 0; i < 5; i++) {
    newExplanation = newExplanation.split(placeholders[i]).join(CIRCLED_NUMS[oldToNew[i]]);
  }

  return {
    ...qd,
    Options: newOpts,
    CorrectAnswer: newCorrect,
    Explanation: newExplanation,
  };
}

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
  if (type === '어법-고난도') {
    question_data = { ...question_data, Options: GRAMMAR_HARD_VARIANT_OPTIONS_FIXED };
    const rawCa = typeof question_data.CorrectAnswer === 'string' ? question_data.CorrectAnswer : '';
    const normalized = normalizeGrammarHardCorrectAnswer(rawCa);
    if (GRAMMAR_HARD_CORRECT_ANSWER_PATTERN.test(normalized)) {
      question_data = { ...question_data, CorrectAnswer: normalized };
    } else {
      return {
        ok: false,
        error: `어법-고난도 CorrectAnswer는 동그라미 번호 2~5개 연속(예: ①③) 형식이어야 합니다. 받은 값: "${rawCa}"`,
      };
    }
  }
  if (type === '어휘-고난도') {
    // 어휘(문맥) "모두 고르기" — Options 는 어휘 base 와 동일하게 단어를 유지하고,
    // CorrectAnswer 만 복수 동그라미(예: ②④)로 정규화·검증한다(어법-고난도와 동일 규칙).
    const rawCa = typeof question_data.CorrectAnswer === 'string' ? question_data.CorrectAnswer : '';
    const normalized = normalizeGrammarHardCorrectAnswer(rawCa);
    if (GRAMMAR_HARD_CORRECT_ANSWER_PATTERN.test(normalized)) {
      question_data = { ...question_data, CorrectAnswer: normalized };
    } else {
      return {
        ok: false,
        error: `어휘-고난도 CorrectAnswer는 동그라미 번호 2~5개 연속(예: ②④) 형식이어야 합니다. 받은 값: "${rawCa}"`,
      };
    }
  }
  // 삽입·삽입-고난도·무관한문장: Options는 위치 번호만(①~⑤). AI가 "① ①" 식으로 중복 생성하는 버그 방지.
  if (type === '삽입' || type === '삽입-고난도') {
    question_data = { ...question_data, Options: INSERTION_OPTIONS_FIXED };
  }
  if (type === '무관한문장' || type === '무관한문장-고난도') {
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

  // 정답 번호 분포: 동그라미 번호가 한 자리에 치우치지 않도록 보기를 무작위 순열로 섞고
  // CorrectAnswer·Explanation의 번호 참조도 함께 갱신.
  if (SHUFFLABLE_TYPES.has(type)) {
    question_data = shuffleQuestionDataForDistribution(question_data);
  }

  const enrichedQd = enrichQuestionDataWithExplanationIfEmpty(question_data, type);
  if (enrichedQd) question_data = enrichedQd;

  const now = new Date();
  const difficulty = isAdvancedVariantType(type)
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
  const serialNo = await nextGeneratedSerial(db);
  const r = await db.collection('generated_questions').insertOne({ ...doc, serialNo });
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
