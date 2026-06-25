import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 일정관리 — 학원 일정(수업·시험·상담·행사 등)을 날짜별로 등록·관리. 학생 관계 없음.
 */
export const VIP_SCHEDULES_COLLECTION = 'vip_schedules';

export const SCHEDULE_CATEGORIES = ['수업', '시험', '상담', '행사', '휴원', '기타'] as const;
export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];
export function isScheduleCategory(v: unknown): v is ScheduleCategory {
  return typeof v === 'string' && (SCHEDULE_CATEGORIES as readonly string[]).includes(v);
}

export interface VipSchedule {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  date: string; // 'YYYY-MM-DD'
  time?: string; // 'HH:MM' (선택)
  category: ScheduleCategory;
  description: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureScheduleIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_SCHEDULES_COLLECTION).createIndex({ userId: 1, date: 1, time: 1 }),
    db.collection(VIP_SCHEDULES_COLLECTION).createIndex({ userId: 1, category: 1 }),
  ]);
}
