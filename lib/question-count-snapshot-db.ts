import type { Collection, Document } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { QuestionCountValidationPayload } from '@/lib/question-count-validation';

/** DB 저장용(ok 필드 제외) */
export type QuestionCountSnapshotReportStored = Omit<QuestionCountValidationPayload, 'ok'>;

export function questionCountPayloadToStored(
  r: QuestionCountValidationPayload
): QuestionCountSnapshotReportStored {
  const { ok: _ok, ...rest } = r;
  return rest;
}

export const QUESTION_COUNT_SNAPSHOT_COLLECTION = 'question_count_validation_snapshots';

let indexesEnsured = false;

export async function ensureQuestionCountSnapshotIndexes(col: Collection<Document>) {
  if (indexesEnsured) return;
  await col.createIndex({ saved_at: -1 });
  await col.createIndex({ textbook: 1, saved_at: -1 });
  indexesEnsured = true;
}

export type QuestionCountSnapshotDoc = {
  saved_at: Date;
  saved_by_login_id: string | null;
  note: string | null;
  /** 검증 시 사용한 조회 파라미터(재현용) */
  query: {
    scope: 'textbook' | 'order';
    textbook: string;
    order_id: string | null;
    required_per_type: number;
    /** 변형문 status 집계: all | 대기 | 완료 */
    question_status?: 'all' | '대기' | '완료';
  };
  /** runQuestionCountValidation 결과 전체(행 목록 포함) */
  report: QuestionCountSnapshotReportStored;
};

export async function getQuestionCountSnapshotsCollection() {
  const db = await getDb('gomijoshua');
  const col = db.collection<Document>(QUESTION_COUNT_SNAPSHOT_COLLECTION);
  await ensureQuestionCountSnapshotIndexes(col);
  return col;
}
