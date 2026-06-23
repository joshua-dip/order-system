import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 숙제/과제 — 내 문제은행에서 고른 문항 세트를 학생들에게 배정하고 진행상태를 관리.
 * 학생별 진행상태(배정→제출→완료)는 targets 에 임베드.
 */
export const VIP_ASSIGNMENTS_COLLECTION = 'vip_assignments';

export type AssignmentStatus = 'assigned' | 'submitted' | 'done';
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ['assigned', 'submitted', 'done'];
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  assigned: '배정', submitted: '제출', done: '완료',
};
export function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === 'string' && (ASSIGNMENT_STATUSES as string[]).includes(v);
}

export interface VipAssignmentTarget {
  studentId: ObjectId;
  studentName: string;
  status: AssignmentStatus;
  updatedAt?: Date;
}

export interface VipAssignment {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  questionIds: ObjectId[]; // generated_questions._id
  targets: VipAssignmentTarget[];
  dueDate?: string | null; // 'YYYY-MM-DD'
  memo?: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureAssignmentIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await db.collection(VIP_ASSIGNMENTS_COLLECTION).createIndex({ userId: 1, createdAt: -1 });
}
