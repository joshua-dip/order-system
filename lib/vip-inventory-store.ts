import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 재고 관리 — 교재·물품 재고 수량 관리. 최소 보유량(minQuantity) 미만이면 부족 품목으로 집계.
 */
export const VIP_INVENTORY_COLLECTION = 'vip_inventory';

export interface VipInventoryItem {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minQuantity: number;
  location: string;
  note: string;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureInventoryIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_INVENTORY_COLLECTION).createIndex({ userId: 1, name: 1 }),
    db.collection(VIP_INVENTORY_COLLECTION).createIndex({ userId: 1, category: 1 }),
  ]);
}
