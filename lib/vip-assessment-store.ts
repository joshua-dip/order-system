import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 수행평가 관리 — 학교 수행평가 일정·유형·마감일과 진행 상태를 관리.
 * status='예정' = 다가올 수행평가, '진행' = 준비/진행 중, '완료' = 마친 수행평가.
 */
export const VIP_ASSESSMENTS_COLLECTION = 'vip_assessments';

export const ASSESSMENT_TYPES = ['발표', '보고서', '실기', '지필', '기타'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
export function isAssessmentType(v: unknown): v is AssessmentType {
  return typeof v === 'string' && (ASSESSMENT_TYPES as readonly string[]).includes(v);
}

export const ASSESSMENT_STATUSES = ['예정', '진행', '완료'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];
export function isAssessmentStatus(v: unknown): v is AssessmentStatus {
  return typeof v === 'string' && (ASSESSMENT_STATUSES as readonly string[]).includes(v);
}

export interface VipAssessment {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  subject: string;
  school: string;
  grade: string;
  type: AssessmentType;
  dueDate: string; // '' 또는 'YYYY-MM-DD'
  description: string;
  status: AssessmentStatus;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureAssessmentIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_ASSESSMENTS_COLLECTION).createIndex({ userId: 1, status: 1, dueDate: 1 }),
    db.collection(VIP_ASSESSMENTS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }),
  ]);
}
