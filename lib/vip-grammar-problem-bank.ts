import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/**
 * VIP 영어 문법 문제은행 (vip_grammar_problems).
 * - 문법 문제관리 진도 트리의 topicKey 로 문제를 매칭 (grammarTopicKey — lib/grammar-curriculum.ts)
 * - 소유자(userId) 단위 스코프 — 계정 간 공유 없음.
 * - 고유번호: counters 원자 $inc → 정수 serialNo, 표시 G-000123 (generated-question-serial 패턴).
 */

export const GRAMMAR_PROBLEMS_COLLECTION = 'vip_grammar_problems';
export const GRAMMAR_SERIAL_COUNTER_ID = 'vip_grammar_problems_serial';

export interface GrammarProblemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  serialNo: number;
  topicKey: string; // 과정 > 대단원 > 학습주제 (grammarTopicKey)
  과정: string;
  대단원: string;
  학습주제: string;
  unit: number; // 커리큘럼 내 유닛 순번 (정렬용)
  section: string; // A/B/C/D
  no: number; // 섹션 내 번호
  type: string; // 선택형 | 빈칸(보기) | 고쳐쓰기 | 영작 | ...
  instruction: string; // 섹션 지시문
  choices?: string[]; // 빈칸(보기) 섹션의 |보기|
  question: string; // 문항 본문 (<u>..</u> 밑줄 허용)
  answer: string;
  explanation?: string;
  source: string; // 출처 라벨 (예: 자체 제작 LEVEL 1)
  createdAt: Date;
  updatedAt: Date;
}

/** 다음 고유 일련번호를 원자적으로 발급. */
export async function nextGrammarSerial(db: Db): Promise<number> {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: GRAMMAR_SERIAL_COUNTER_ID as unknown as ObjectId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = (result as unknown as { seq?: number })?.seq;
  return typeof seq === 'number' && seq > 0 ? seq : 1;
}

/** 표시용 포맷: G-000123. */
export function formatGrammarSerial(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `G-${String(Math.floor(v)).padStart(6, '0')}`;
}
