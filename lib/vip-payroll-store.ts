import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 급여 관리 — 직원·강사 급여(기본급·수당·공제)를 월별로 관리.
 * netPay = 기본급 + 수당 − 공제.
 */
export const VIP_PAYROLL_COLLECTION = 'vip_payroll';

export interface VipPayroll {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  name: string;
  role: string;
  month: string; // 'YYYY-MM'
  baseSalary: number;
  bonus: number;
  deduction: number;
  paid: boolean;
  payDate: string; // '' or 'YYYY-MM-DD'
  memo: string;
  createdAt: Date;
  updatedAt?: Date;
}

/** 실지급액 = 기본급 + 수당 − 공제. */
export function netPay(p: { baseSalary?: number; bonus?: number; deduction?: number }): number {
  return (p.baseSalary || 0) + (p.bonus || 0) - (p.deduction || 0);
}

let _indexed = false;
export async function ensurePayrollIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await db.collection(VIP_PAYROLL_COLLECTION).createIndex({ userId: 1, month: -1, name: 1 });
}
