import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 학원 교습소 정보 — 학원/교습소 기본 정보를 회원당 한 문서로 보관.
 * 다른 메뉴·문서에서 참고할 수 있는 단일 편집형 레코드 (목록 아님).
 */
export const VIP_ACADEMY_COLLECTION = 'vip_academy_info';

export interface VipAcademyInfo {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  regNumber: string;
  owner: string;
  address: string;
  phone: string;
  subjects: string;
  capacity: number | null;
  openDate: string; // '' 또는 'YYYY-MM-DD'
  note: string;
  updatedAt: Date;
}

let _indexed = false;
export async function ensureAcademyIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await db.collection(VIP_ACADEMY_COLLECTION).createIndex({ userId: 1 }, { unique: true });
}

/** 학원당 한 문서이므로 회원당 한 번에 입력하는 깨끗한 필드 객체로 정제. (userId/updatedAt 제외) */
export function sanitizeAcademy(body: Record<string, unknown>): Omit<VipAcademyInfo, '_id' | 'userId' | 'updatedAt'> {
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').trim().slice(0, max);

  const openDateRaw = (typeof body.openDate === 'string' ? body.openDate : '').trim();
  const openDate = /^\d{4}-\d{2}-\d{2}$/.test(openDateRaw) ? openDateRaw : '';

  let capacity: number | null = null;
  const capRaw = body.capacity;
  if (capRaw !== '' && capRaw !== null && capRaw !== undefined) {
    const n = Number(capRaw);
    if (Number.isFinite(n) && n >= 0) capacity = Math.floor(n);
  }

  return {
    name: str(body.name, 120),
    regNumber: str(body.regNumber, 60),
    owner: str(body.owner, 60),
    address: str(body.address, 200),
    phone: str(body.phone, 40),
    subjects: str(body.subjects, 200),
    capacity,
    openDate,
    note: str(body.note, 1000),
  };
}
