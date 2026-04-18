import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';
import { GUEST_GENERATED_QUESTIONS_COLLECTION, type GuestGeneratedQuestionDoc } from '@/lib/guest-generated-questions-store';

export type PromoteGuestLogOptions = {
  status?: '대기' | '완료';
  overrideQuestionData?: Record<string, unknown>;
  adminLoginId?: string;
};

export type PromoteGuestLogResult =
  | {
      ok: true;
      guest_log_id: string;
      generated_question_id: string;
      was_edited: boolean;
    }
  | { ok: false; guest_log_id: string; error: string; code?: 'not_found' | 'not_matched' | 'already_exists' | 'already_promoted' | 'save_failed' };

/**
 * 단일 guest_generated_questions 로그를 정식 generated_questions 로 승격.
 */
export async function promoteGuestLog(
  logId: string,
  options: PromoteGuestLogOptions = {},
): Promise<PromoteGuestLogResult> {
  if (!ObjectId.isValid(logId)) {
    return { ok: false, guest_log_id: logId, error: '유효하지 않은 id', code: 'not_found' };
  }
  const oid = new ObjectId(logId);
  const db = await getDb('gomijoshua');
  const col = db.collection<GuestGeneratedQuestionDoc>(GUEST_GENERATED_QUESTIONS_COLLECTION);
  const gqCol = db.collection('generated_questions');

  const doc = await col.findOne({ _id: oid });
  if (!doc) return { ok: false, guest_log_id: logId, error: '찾을 수 없습니다.', code: 'not_found' };

  if (doc.promoted_to) {
    return {
      ok: false,
      guest_log_id: logId,
      error: '이미 승격된 로그입니다.',
      code: 'already_promoted',
    };
  }

  if (doc.match_status !== 'matched' || !doc.passage_id || !doc.textbook) {
    return {
      ok: false,
      guest_log_id: logId,
      error: '매칭되지 않은 로그는 먼저 지문을 등록해야 합니다.',
      code: 'not_matched',
    };
  }

  const passageIdStr = String(doc.passage_id);
  const type = doc.type;
  const question_data = options.overrideQuestionData || doc.question_data;

  // 기존 generated_questions 중복 체크 — (passage_id, type, question_data.Paragraph) 동일
  const newParagraph = typeof (question_data as { Paragraph?: string }).Paragraph === 'string'
    ? (question_data as { Paragraph: string }).Paragraph.trim()
    : '';
  if (newParagraph) {
    const dup = await gqCol.findOne(
      {
        passage_id: doc.passage_id,
        type,
        'question_data.Paragraph': newParagraph,
      },
      { projection: { _id: 1 } },
    );
    if (dup) {
      return {
        ok: false,
        guest_log_id: logId,
        error: '이미 동일한 변형문제가 존재합니다.',
        code: 'already_exists',
      };
    }
  }

  const saved = await saveGeneratedQuestionToDb({
    passage_id: passageIdStr,
    textbook: doc.textbook,
    source: doc.source || doc.source_key || [doc.chapter, doc.number].filter(Boolean).join(' ').trim() || '지문',
    type,
    question_data,
    status: options.status || '대기',
    option_type: 'English',
    difficulty: doc.difficulty,
  });

  if (!saved.ok) {
    return { ok: false, guest_log_id: logId, error: saved.error, code: 'save_failed' };
  }

  const wasEdited = !!options.overrideQuestionData;
  await col.updateOne(
    { _id: oid },
    {
      $set: {
        promoted_to: new ObjectId(saved.inserted_id),
        promoted_at: new Date(),
        ...(options.adminLoginId ? { promoted_by: options.adminLoginId } : {}),
        ...(wasEdited ? { edited_before_promote: true } : {}),
      },
    },
  );

  return {
    ok: true,
    guest_log_id: logId,
    generated_question_id: saved.inserted_id,
    was_edited: wasEdited,
  };
}
