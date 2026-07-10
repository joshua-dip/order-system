import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/**
 * VIP 영어 라이팅 문제은행 (vip_writing_problems). 문법 문제은행과 동일 구조.
 * - 라이팅 진도 트리의 topicKey 로 문제를 매칭 (writingTopicKey — lib/writing-curriculum.ts)
 * - 소유자(userId) 스코프. 고유번호: counters 원자 $inc → 정수 serialNo, 표시 W-000123.
 */
export const WRITING_PROBLEMS_COLLECTION = 'vip_writing_problems';
export const WRITING_SERIAL_COUNTER_ID = 'vip_writing_problems_serial';

export interface WritingProblemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  serialNo: number;
  topicKey: string;
  과정: string;
  대단원: string;
  학습주제: string;
  unit: number;
  section: string;
  no: number;
  type: string;
  instruction: string;
  choices?: string[];
  options?: string[];
  question: string;
  answer: string;
  explanation?: string;
  source: string;
  subjective?: { type?: string; instruction?: string; answer?: string; choices?: string[] };
  createdAt: Date;
  updatedAt: Date;
}

/** 다음 고유 일련번호를 원자적으로 발급. */
export async function nextWritingSerial(db: Db): Promise<number> {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: WRITING_SERIAL_COUNTER_ID as unknown as ObjectId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = (result as unknown as { seq?: number })?.seq;
  return typeof seq === 'number' && seq > 0 ? seq : 1;
}

/** 표시용 포맷: W-000123. */
export function formatWritingSerial(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `W-${String(Math.floor(v)).padStart(6, '0')}`;
}
