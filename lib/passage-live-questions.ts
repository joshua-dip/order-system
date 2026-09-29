/**
 * 클래스키트 「수업 화면」 — 지문 아래에 붙이는 실전 문항.
 *
 * 관리자는 판매 재고(generated_questions, 완료)에서 유형마다 몇 개씩 보여 준다.
 * 회원·비회원은 **공개 무료 세트(public_free_questions)만** 본다 — 판매 재고를 화면에 풀면
 * 주문해야 받는 문항이 공짜가 되기 때문이다(public-free-questions.ts 의 분리 원칙과 같다).
 * 기출 지문은 원출처 지문의 문항을 끌어온다(exam-origin).
 */
import { ObjectId, type Db } from 'mongodb';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { resolveExamOrigins } from '@/lib/exam-origin';
import { PUBLIC_FREE_QUESTIONS_COLLECTION } from '@/lib/public-free-questions';

export type LiveQuestionScope = 'stock' | 'free';

export type LiveQuestion = {
  id: string;
  type: string;
  question: string;
  paragraph: string;
  options: string[];
  answer: string;
  explanation: string;
};

export type LiveQuestionsPayload = {
  scope: LiveQuestionScope;
  types: string[];
  items: LiveQuestion[];
  /** 기출 지문이면 끌어온 원출처 */
  pulledFrom?: string;
};

/** 선택지 — `###` 구분이면 그걸로, 아니면 줄 단위 */
export function parseLiveOptions(raw: unknown): string[] {
  const s = String(raw ?? '');
  const parts = s.includes('###') ? s.split('###') : s.split('\n');
  return parts.map((o) => o.trim()).filter(Boolean);
}

const TYPE_ORDER: readonly string[] = BOOK_VARIANT_QUESTION_TYPES;
const typeRank = (t: string) => {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? 999 : i;
};

export async function loadLiveQuestions(
  db: Db,
  passageId: string,
  scope: LiveQuestionScope,
  perType = 3,
): Promise<LiveQuestionsPayload> {
  const origins = await resolveExamOrigins(db, [passageId]);
  const origin = origins.get(passageId);
  const pid = origin ? origin.originId : new ObjectId(passageId);
  const byPid = { $or: [{ passage_id: pid }, { passage_id: pid.toHexString() }] };

  const col = db.collection(scope === 'stock' ? 'generated_questions' : PUBLIC_FREE_QUESTIONS_COLLECTION);
  const rows = await col
    .aggregate<{ _id: string; docs: Record<string, unknown>[] }>([
      { $match: { ...byPid, status: '완료', type: { $ne: '워크북어법' } } },
      // 영어판을 먼저, 그다음 최근 것
      { $addFields: { _en: { $cond: [{ $eq: ['$option_type', 'English'] }, 0, 1] } } },
      { $sort: { _en: 1, created_at: -1, _id: -1 } },
      { $group: { _id: '$type', docs: { $push: { _id: '$_id', type: '$type', question_data: '$question_data' } } } },
      { $project: { docs: { $slice: ['$docs', perType] } } },
    ])
    .toArray();

  const items: LiveQuestion[] = rows
    .sort((a, b) => typeRank(a._id) - typeRank(b._id))
    .flatMap((r) =>
      r.docs.map((d) => {
        const qd = (d.question_data ?? {}) as Record<string, unknown>;
        return {
          id: String(d._id),
          type: String(d.type ?? r._id),
          question: String(qd.Question ?? ''),
          paragraph: String(qd.Paragraph ?? ''),
          options: parseLiveOptions(qd.Options),
          answer: String(qd.CorrectAnswer ?? '').trim(),
          explanation: String(qd.Explanation ?? ''),
        };
      }),
    )
    .filter((q) => q.question || q.paragraph);

  return {
    scope,
    types: [...new Set(items.map((q) => q.type))],
    items,
    ...(origin ? { pulledFrom: origin.originSourceKey || origin.originTextbook } : {}),
  };
}
