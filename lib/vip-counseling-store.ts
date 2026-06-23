import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 상담 관리 — 학생별 상담 예약(예정)·기록(완료) 관리. vip_students 기반.
 * status='예정' = 다가올 상담 일정, status='완료' = 진행한 상담 기록. (옛 기록은 status 없음 → 완료로 간주)
 */
export const VIP_COUNSELING_COLLECTION = 'vip_counselings';

export const COUNSELING_TYPES = ['전화', '대면', '문자', '기타'] as const;
export type CounselingType = (typeof COUNSELING_TYPES)[number];
export function isCounselingType(v: unknown): v is CounselingType {
  return typeof v === 'string' && (COUNSELING_TYPES as readonly string[]).includes(v);
}

export const COUNSELING_STATUSES = ['예정', '완료'] as const;
export type CounselingStatus = (typeof COUNSELING_STATUSES)[number];
export function isCounselingStatus(v: unknown): v is CounselingStatus {
  return typeof v === 'string' && (COUNSELING_STATUSES as readonly string[]).includes(v);
}
/** 옛 데이터(status 없음)는 완료로 간주. */
export function counselingStatusOf(c: { status?: unknown }): CounselingStatus {
  return c.status === '예정' ? '예정' : '완료';
}

export interface VipCounseling {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  studentId: ObjectId;
  studentName: string;
  date: string; // 'YYYY-MM-DD' (예정=예약일, 완료=상담일)
  time?: string; // 'HH:MM' (예정 상담 시간, 선택)
  status?: CounselingStatus; // 없으면 완료
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
    db.collection(VIP_COUNSELING_COLLECTION).createIndex({ userId: 1, status: 1, date: 1 }),
  ]);
}
