/**
 * 서술형 변형(narrative_questions) Pro 전용 저장 — 채팅에서 작성한 question_data 를 검증 후 insert.
 * 객관식 변형의 lib/variant-save-generated-question.ts 에 대응. API 호출 없음.
 *
 * 작성자 마커: source_file='claude-code', excel_row_status='claude-authored', authored_by='claude-code'
 *  → 엑셀 임포트분(curated)과 구분·필터 가능.
 */
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { validateNarrativeQuestion } from '@/lib/narrative-question-validator';

export const NARRATIVE_AUTHOR_MARKER = 'claude-code';

export interface SaveNarrativeInput {
  passage_id: string;
  textbook?: string;
  narrative_subtype: string;
  chapter?: string;
  number?: string;
  question_data: Record<string, unknown>;
  status?: string;
}

export type SaveNarrativeResult =
  | {
      ok: true;
      inserted_id: string;
      textbook: string;
      passage_id: string;
      narrative_subtype: string;
      number: string;
      warnings: string[];
    }
  | { ok: false; error: string; warnings?: string[] };

export async function saveNarrativeQuestionToDb(
  input: SaveNarrativeInput,
): Promise<SaveNarrativeResult> {
  const pidStr = (input.passage_id ?? '').trim();
  if (!pidStr || !ObjectId.isValid(pidStr)) {
    return { ok: false, error: '유효한 passage_id 가 필요합니다.' };
  }
  const subtype = (input.narrative_subtype ?? '').trim();
  const qd = { ...(input.question_data ?? {}) } as Record<string, unknown>;

  const v = validateNarrativeQuestion(subtype, qd);
  if (!v.ok) return { ok: false, error: v.errors.join(' / '), warnings: v.warnings };

  const db = await getDb('gomijoshua');
  const passage = await db.collection('passages').findOne({ _id: new ObjectId(pidStr) });
  if (!passage) {
    return { ok: false, error: `passage_id ${pidStr} 를 passages 에서 찾을 수 없습니다.`, warnings: v.warnings };
  }

  const textbook = (input.textbook ?? '').trim() || String(passage.textbook ?? '');
  const sourceKey = String(passage.source_key ?? '');
  const number = (input.number ?? '').trim() || String(qd['번호'] ?? passage.number ?? '');
  const chapter = (input.chapter ?? '').trim() || String(qd['강'] ?? passage.chapter ?? '');

  if (!textbook) return { ok: false, error: 'textbook 을 확인할 수 없습니다(passage 에 없음).', warnings: v.warnings };

  /* 메타 보강 (엑셀 스키마 필드 대응 + 작성자 표시) */
  if (!qd['번호']) qd['번호'] = number;
  if (!qd['강']) qd['강'] = chapter;
  if (!qd['문제유형']) qd['문제유형'] = subtype;
  qd['처리상태'] = '성공';
  qd['생성일시'] = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const now = new Date();
  const doc: Record<string, unknown> = {
    textbook,
    passage_id: new ObjectId(pidStr),
    chapter,
    number,
    narrative_subtype: subtype,
    question_data: qd,
    source_file: NARRATIVE_AUTHOR_MARKER,
    source_key_matched: sourceKey,
    excel_row_status: 'claude-authored',
    authored_by: NARRATIVE_AUTHOR_MARKER,
    status: (input.status ?? '대기').trim() || '대기',
    created_at: now,
  };

  const r = await db.collection('narrative_questions').insertOne(doc);
  return {
    ok: true,
    inserted_id: String(r.insertedId),
    textbook,
    passage_id: pidStr,
    narrative_subtype: subtype,
    number,
    warnings: v.warnings,
  };
}
