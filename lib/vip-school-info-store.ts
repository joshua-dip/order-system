import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 학교 정보 관리 — 학생들이 다니는 학교의 참고 정보(연락처·시험 일정 등). 학생이 아닌 학교 목록.
 * (NEIS 학교 조회 기능 'vip_schools' 와는 별개 — 선생님이 직접 관리하는 메모성 학교 정보.)
 */
export const VIP_SCHOOL_INFO_COLLECTION = 'vip_school_info';

export const SCHOOL_LEVELS = ['초등', '중등', '고등', '기타'] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];
export function isSchoolLevel(v: unknown): v is SchoolLevel {
  return typeof v === 'string' && (SCHOOL_LEVELS as readonly string[]).includes(v);
}

export interface VipSchoolInfo {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  name: string;
  level: SchoolLevel;
  address: string;
  phone: string;
  examInfo: string; // 시험 일정·특이사항
  note: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureSchoolInfoIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_SCHOOL_INFO_COLLECTION).createIndex({ userId: 1, name: 1 }),
    db.collection(VIP_SCHOOL_INFO_COLLECTION).createIndex({ userId: 1, level: 1 }),
  ]);
}
