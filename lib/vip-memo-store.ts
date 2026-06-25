import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 메모장 — 선생님(VIP)용 간단 메모·할 일 보드. 학생 연관 없음(노트 보드).
 * 색상 태그(default/yellow/blue/green/pink) + 고정(pinned) 으로 정렬·강조.
 */
export const VIP_MEMOS_COLLECTION = 'vip_memos';

export const MEMO_COLORS = ['default', 'yellow', 'blue', 'green', 'pink'] as const;
export type MemoColor = (typeof MEMO_COLORS)[number];
export function isMemoColor(v: unknown): v is MemoColor {
  return typeof v === 'string' && (MEMO_COLORS as readonly string[]).includes(v);
}

export interface VipMemo {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  content: string;
  color: MemoColor;
  pinned: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureMemoIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_MEMOS_COLLECTION).createIndex({ userId: 1, pinned: -1, updatedAt: -1 }),
  ]);
}
