import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/**
 * 그래머와이즈 등 시판 교재의 「정답키」 — 채점 자동화용.
 * - (book, unit, section, no) → 정답 문자열. 문제 본문·해설은 저장하지 않는다(정답 사실만).
 * - 소유자(userId) 스코프 · 내부 전용 — 공개 API(/api/public/*)로 절대 노출하지 않는다.
 *   (출판 교재 답지는 라이선스 보유자 내부 채점용으로만 사용)
 */
export const GRAMMAR_ANSWER_KEY_COLLECTION = 'vip_grammar_answer_keys';

export interface GrammarAnswerKeyDoc {
  _id?: ObjectId;
  userId: ObjectId;
  book: string; // 예: 그래머와이즈 LEVEL 1
  unit: number;
  chapter: string;
  title: string; // UNIT 제목
  /** 섹션(A~D) → 번호순 정답 배열. 1번 = [0]. */
  exercises: Record<string, string[]>;
  answerCount: number;
  source: string; // 'grammarwise-official'
  internal: true; // 항상 내부 전용 마커
  createdAt: Date;
  updatedAt: Date;
}

/** 특정 (book,unit,section,no) 정답 조회 — 채점기용. no 는 1-기반. */
export function lookupAnswer(doc: GrammarAnswerKeyDoc | null, section: string, no: number): string | null {
  if (!doc) return null;
  const arr = doc.exercises?.[section];
  if (!Array.isArray(arr)) return null;
  return arr[no - 1] ?? null;
}

export async function ensureAnswerKeyIndexes(db: Db): Promise<void> {
  await db.collection(GRAMMAR_ANSWER_KEY_COLLECTION).createIndex({ userId: 1, book: 1, unit: 1 }, { unique: true }).catch(() => {});
}
