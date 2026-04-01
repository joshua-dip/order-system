import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  GENERATED_QUESTION_CLAUDE_REVIEWS_COL,
  type ReviewLogDoc,
} from '@/lib/generated-question-review-log';
import { checkSolveCorrect } from '@/lib/generated-question-solve-core';

/**
 * DB·MCP·수동 저장 등으로 키가 달라도 검수·목록에서 읽기.
 * - PascalCase 표준 + camelCase + 한글 별칭
 * - `question_data` 안에 또 `question_data` 가 중첩된 경우 펼침
 */
function normalizeQuestionDataRoot(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const qd = raw as Record<string, unknown>;
  const nested = qd.question_data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>), ...qd };
  }
  return qd;
}

function pickQuestionDataString(qd: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = qd[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
  }
  return '';
}

export function getQuestionDataForReview(raw: unknown): {
  question: string;
  paragraph: string;
  options: string;
  correctAnswer: string;
} {
  const qd = normalizeQuestionDataRoot(raw);
  return {
    question: pickQuestionDataString(qd, ['Question', 'question', '발문', 'stem']),
    paragraph: pickQuestionDataString(qd, ['Paragraph', 'paragraph', '지문', 'passage', 'body']),
    options: pickQuestionDataString(qd, ['Options', 'options', '보기', 'choices']),
    correctAnswer: pickQuestionDataString(qd, [
      'CorrectAnswer',
      'correctAnswer',
      '정답',
      'answer',
      'correct_answer',
    ]),
  };
}

/** Claude Code가 풀이할 때 사용 — 정답은 포함하지 않음 */
export type PendingReviewItem = {
  generated_question_id: string;
  textbook: string;
  source: string;
  type: string;
  status: string;
  question: string;
  paragraph: string;
  options: string;
  issue: string | null;
};

/**
 * status「대기」문항 목록만 반환 (Anthropic API 없음).
 */
export async function listPendingReviewItems(opts: {
  limit: number;
  textbook?: string;
}): Promise<{ items: PendingReviewItem[] }> {
  const limit = Math.min(30, Math.max(1, opts.limit));
  const textbook = (opts.textbook ?? '').trim();

  const db = await getDb('gomijoshua');
  const gqCol = db.collection('generated_questions');

  const filter: Record<string, unknown> = { status: '대기' };
  if (textbook) filter.textbook = textbook;

  const docs = await gqCol
    .find(filter)
    .sort({ created_at: 1 })
    .limit(limit)
    .toArray();

  const items: PendingReviewItem[] = docs.map((doc) => {
    const id = doc._id as ObjectId;
    const { question, paragraph, options } = getQuestionDataForReview(doc.question_data);
    const issue = !question && !paragraph ? '발문·지문 없음' : null;
    return {
      generated_question_id: id.toString(),
      textbook: String(doc.textbook ?? ''),
      source: String(doc.source ?? ''),
      type: String(doc.type ?? '').trim(),
      status: String(doc.status ?? ''),
      question,
      paragraph,
      options,
      issue,
    };
  });

  return { items };
}

export type RecordReviewResult = {
  ok: boolean;
  generated_question_id: string;
  is_correct?: boolean | null;
  error?: string;
  /** DB 정답과 일치하고 원래 status가 대기였을 때 완료로 갱신했으면 true */
  status_updated_to_complete?: boolean;
  /** 재시도(attemptNumber≥2) 후 정답일 때 검수불일치로 갱신했으면 true */
  status_updated_to_mismatch?: boolean;
};

/**
 * Claude Code가 푼 뒤 호출 — DB 정답과 비교해 로그만 저장 (Anthropic API 없음).
 */
export async function recordReviewLogFromClaudeCode(opts: {
  generated_question_id: string;
  claude_answer: string;
  claude_response: string;
  model?: string;
  /** 풀이 실패·스킵 시 메시지 */
  error?: string | null;
  admin_login_id: string | null;
  /** 2 이상이면 정답일 때 status를 완료 대신 검수불일치로 둠(미지정·1은 기존과 동일) */
  attemptNumber?: number | null;
}): Promise<RecordReviewResult> {
  const idStr = opts.generated_question_id.trim();
  if (!ObjectId.isValid(idStr)) {
    return { ok: false, generated_question_id: idStr, error: '유효하지 않은 generated_question_id' };
  }

  const db = await getDb('gomijoshua');
  const gqCol = db.collection('generated_questions');
  const logCol = db.collection(GENERATED_QUESTION_CLAUDE_REVIEWS_COL);

  const doc = await gqCol.findOne({ _id: new ObjectId(idStr) });
  if (!doc) {
    return { ok: false, generated_question_id: idStr, error: 'generated_questions 에서 문항을 찾을 수 없습니다.' };
  }

  const oid = doc._id as ObjectId;
  const { question, paragraph, correctAnswer } = getQuestionDataForReview(doc.question_data);
  const typeStr = String(doc.type ?? '').trim();
  const preview =
    question.length > 220 ? `${question.slice(0, 220)}…` : question;
  const model = (opts.model ?? '').trim() || 'claude-code';
  const errMsg = (opts.error ?? '').trim();

  if (errMsg) {
    await logCol.insertOne({
      generated_question_id: oid,
      textbook: String(doc.textbook ?? ''),
      source: String(doc.source ?? ''),
      type: typeStr,
      status_at_run: String(doc.status ?? ''),
      question_preview: preview,
      correct_answer: correctAnswer,
      claude_answer: opts.claude_answer.trim(),
      claude_response: opts.claude_response.trim(),
      is_correct: null,
      model,
      run_mode: 'claude_code_record',
      error: errMsg,
      admin_login_id: opts.admin_login_id,
      created_at: new Date(),
    } satisfies ReviewLogDoc);
    return { ok: true, generated_question_id: idStr, is_correct: null };
  }

  if (!question && !paragraph) {
    const err = '발문·지문 없음';
    await logCol.insertOne({
      generated_question_id: oid,
      textbook: String(doc.textbook ?? ''),
      source: String(doc.source ?? ''),
      type: typeStr,
      status_at_run: String(doc.status ?? ''),
      question_preview: '',
      correct_answer: correctAnswer,
      claude_answer: '',
      claude_response: '',
      is_correct: null,
      model,
      run_mode: 'claude_code_record',
      error: err,
      admin_login_id: opts.admin_login_id,
      created_at: new Date(),
    } satisfies ReviewLogDoc);
    return { ok: true, generated_question_id: idStr, is_correct: null, error: err };
  }

  const claudeAnswer = opts.claude_answer.trim();
  const claudeResponse = opts.claude_response.trim();
  const isCorrect = correctAnswer ? checkSolveCorrect(claudeAnswer, correctAnswer) : null;

  await logCol.insertOne({
    generated_question_id: oid,
    textbook: String(doc.textbook ?? ''),
    source: String(doc.source ?? ''),
    type: typeStr,
    status_at_run: String(doc.status ?? ''),
    question_preview: preview,
    correct_answer: correctAnswer,
    claude_answer: claudeAnswer,
    claude_response: claudeResponse,
    is_correct: isCorrect,
    model,
    run_mode: 'claude_code_record',
    error: null,
    admin_login_id: opts.admin_login_id,
    created_at: new Date(),
  } satisfies ReviewLogDoc);

  let status_updated_to_complete = false;
  let status_updated_to_mismatch = false;
  if (isCorrect === true && String(doc.status ?? '') === '대기') {
    const att = opts.attemptNumber;
    const retry = att != null && Number.isFinite(att) && att >= 2;
    const nextStatus = retry ? '검수불일치' : '완료';
    const up = await gqCol.updateOne(
      { _id: oid, status: '대기' },
      { $set: { status: nextStatus, updated_at: new Date() } }
    );
    if (up.modifiedCount > 0) {
      if (nextStatus === '완료') status_updated_to_complete = true;
      else status_updated_to_mismatch = true;
    }
  }

  return {
    ok: true,
    generated_question_id: idStr,
    is_correct: isCorrect,
    status_updated_to_complete,
    status_updated_to_mismatch,
  };
}
