import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 수업일지 — 반(vip_classes)별 수업 진도·과제 기록.
 */
export const VIP_LESSON_LOGS_COLLECTION = 'vip_lesson_logs';

export interface VipLessonLog {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  classId: ObjectId;
  className: string;
  date: string; // 'YYYY-MM-DD'
  progress: string; // 진도(오늘 배운 내용)
  homework?: string; // 과제
  memo?: string; // 비고
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureLessonIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_LESSON_LOGS_COLLECTION).createIndex({ userId: 1, date: -1 }),
    db.collection(VIP_LESSON_LOGS_COLLECTION).createIndex({ userId: 1, classId: 1, date: -1 }),
  ]);
}
