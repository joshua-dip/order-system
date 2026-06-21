import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/**
 * 객관식 변형문제(generated_questions) 전역 고유 일련번호.
 * - 저장 시 counters 컬렉션의 원자적 $inc 로 1씩 발급 → top-level `serialNo`(정수)
 * - 표시용 포맷: V-000123 (formatGeneratedSerial)
 * 기존 데이터는 scripts/backfill-generated-serial.ts 로 created_at→_id 순 백필.
 */

export const GENERATED_SERIAL_COUNTER_ID = 'generated_questions_serial';

/** 다음 고유 일련번호를 원자적으로 발급. */
export async function nextGeneratedSerial(db: Db): Promise<number> {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: GENERATED_SERIAL_COUNTER_ID as unknown as ObjectId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = (result as unknown as { seq?: number })?.seq;
  return typeof seq === 'number' && seq > 0 ? seq : 1;
}

/** 표시용 포맷: V-000123 (정수 → 최소 6자리 zero-pad). 값 없으면 빈 문자열. */
export function formatGeneratedSerial(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `V-${String(Math.floor(v)).padStart(6, '0')}`;
}
