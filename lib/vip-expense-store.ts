import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 운영비 관리 — 학원 운영비 지출을 기록·분류하고 월별 합계를 봅니다.
 */
export const VIP_EXPENSES_COLLECTION = 'vip_expenses';

export const EXPENSE_CATEGORIES = ['임대료', '공과금', '비품', '급여', '마케팅', '기타'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return typeof v === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

export interface VipExpense {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  date: string; // 'YYYY-MM-DD' (지출일)
  category: ExpenseCategory;
  amount: number; // 원
  payee: string; // 지급처
  memo: string;
  createdAt: Date;
}

let _indexed = false;
export async function ensureExpenseIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_EXPENSES_COLLECTION).createIndex({ userId: 1, date: -1 }),
    db.collection(VIP_EXPENSES_COLLECTION).createIndex({ userId: 1, category: 1 }),
  ]);
}
