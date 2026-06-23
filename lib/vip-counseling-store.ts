import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 상담일지 — 학생별 상담(전화·대면 등) 기록. vip_students 기반.
 */
export const VIP_COUNSELING_COLLECTION = 'vip_counselings';

export const COUNSELING_TYPES = ['전화', '대면', '문자', '기타'] as const;
export type CounselingType = (typeof COUNSELING_TYPES)[number];
export function isCounselingType(v: unknown): v is CounselingType {
  return typeof v === 'string' && (COUNSELING_TYPES as readonly string[]).includes(v);
}

export interface VipCounseling {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  studentId: ObjectId;
  studentName: string;
  date: string; // 'YYYY-MM-DD'
  type: CounselingType;
  content: string;
  nextPlan?: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureCounselingIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_COUNSELING_COLLECTION).createIndex({ userId: 1, date: -1 }),
    db.collection(VIP_COUNSELING_COLLECTION).createIndex({ userId: 1, studentId: 1, date: -1 }),
  ]);
}
