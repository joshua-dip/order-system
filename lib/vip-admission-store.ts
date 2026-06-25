import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 입시관리 — 학생별 목표 대학·전형·지원/합불 현황. vip_students 기반.
 * status='준비'→'지원'→'1차합격'→'최종합격'/'불합격'→'등록' 흐름.
 */
export const VIP_ADMISSIONS_COLLECTION = 'vip_admissions';

export const ADMISSION_TRACKS = ['수시-학종', '수시-교과', '논술', '정시', '기타'] as const;
export type AdmissionTrack = (typeof ADMISSION_TRACKS)[number];
export function isAdmissionTrack(v: unknown): v is AdmissionTrack {
  return typeof v === 'string' && (ADMISSION_TRACKS as readonly string[]).includes(v);
}

export const ADMISSION_STATUSES = ['준비', '지원', '1차합격', '최종합격', '불합격', '등록'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];
export function isAdmissionStatus(v: unknown): v is AdmissionStatus {
  return typeof v === 'string' && (ADMISSION_STATUSES as readonly string[]).includes(v);
}

export interface VipAdmission {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  studentId: ObjectId;
  studentName: string;
  university: string;
  department: string;
  track: AdmissionTrack;
  status: AdmissionStatus;
  targetDate: string; // 'YYYY-MM-DD' (마감/원서접수일) 또는 ''
  memo: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureAdmissionIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_ADMISSIONS_COLLECTION).createIndex({ userId: 1, studentId: 1 }),
    db.collection(VIP_ADMISSIONS_COLLECTION).createIndex({ userId: 1, status: 1, targetDate: 1 }),
  ]);
}
