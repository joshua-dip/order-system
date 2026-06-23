import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 수강료 청구 — (학생 × 월) 단위 1건.
 * 기본 청구액은 vip_students.subjects[].tuition 합으로 산출하고, 청구서로 확정/수납 처리.
 */
export const VIP_TUITION_COLLECTION = 'vip_tuition_invoices';

export interface VipTuitionInvoice {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  studentId: ObjectId;
  month: string; // 'YYYY-MM'
  amount: number;
  status: 'unpaid' | 'paid';
  paidAt?: Date | null;
  memo?: string;
  createdAt: Date;
  updatedAt?: Date;
}

/** 'YYYY-MM' 형식 검증. */
export function isValidMonth(m: unknown): m is string {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

let _indexed = false;
export async function ensureTuitionIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_TUITION_COLLECTION).createIndex({ userId: 1, studentId: 1, month: 1 }, { unique: true }),
    db.collection(VIP_TUITION_COLLECTION).createIndex({ userId: 1, month: 1 }),
  ]);
}
