import { ObjectId } from 'mongodb';

/** MongoDB: gomijoshua.generated_question_claude_reviews */
export const GENERATED_QUESTION_CLAUDE_REVIEWS_COL = 'generated_question_claude_reviews';

export type ReviewLogDoc = {
  generated_question_id: ObjectId;
  textbook: string;
  source: string;
  type: string;
  status_at_run: string;
  question_preview: string;
  correct_answer: string;
  claude_answer: string;
  claude_response: string;
  is_correct: boolean | null;
  model: string;
  run_mode: 'batch_pending' | 'claude_code_record';
  error: string | null;
  admin_login_id: string | null;
  created_at: Date;
};

export function serializeReviewLog(doc: Record<string, unknown>) {
  const id = doc._id;
  const gqid = doc.generated_question_id;
  return {
    ...doc,
    _id: id != null ? String(id) : '',
    generated_question_id: gqid != null ? String(gqid) : '',
    created_at: doc.created_at ?? null,
  };
}
