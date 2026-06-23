import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 학원 양식 관리 — 동의서·안내문 등 학원 문서 양식을 작성·보관·인쇄.
 * category 로 양식을 폴더처럼 묶고, content 본문을 그대로 인쇄/복사.
 */
export const VIP_FORMS_COLLECTION = 'vip_forms';

export interface VipForm {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  category: string;
  content: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureFormIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_FORMS_COLLECTION).createIndex({ userId: 1, updatedAt: -1, createdAt: -1 }),
    db.collection(VIP_FORMS_COLLECTION).createIndex({ userId: 1, category: 1 }),
  ]);
}
