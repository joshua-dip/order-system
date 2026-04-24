import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export const MEMBERSHIP_APPLICATIONS_COLLECTION = 'membership_applications';

export type MembershipApplicantType = 'student' | 'parent' | 'teacher';
export type MembershipApplicationStatus = 'pending' | 'contacted' | 'completed' | 'rejected';

export const APPLICANT_TYPE_LABELS: Record<MembershipApplicantType, string> = {
  student: '학생',
  parent: '학부모',
  teacher: '선생님',
};

export const STATUS_LABELS: Record<MembershipApplicationStatus, string> = {
  pending: '대기',
  contacted: '연락완료',
  completed: '가입처리완료',
  rejected: '거절',
};

export const SMS_BODY_TEMPLATES: Record<MembershipApplicantType, (name: string, phone: string) => string> = {
  student: (name, phone) => `[학생 가입 신청] ${name} / ${phone}`,
  parent: (name, phone) => `[학부모 가입 신청] ${name} / ${phone}`,
  teacher: (name, phone) => `[선생님 가입 신청] ${name} / ${phone}`,
};

export type MembershipApplicationDoc = {
  _id?: ObjectId;
  applicantType: MembershipApplicantType;
  name: string;
  phone: string;
  status: MembershipApplicationStatus;
  adminMemo?: string;
  appliedAt: Date;
  contactedAt?: Date;
  completedAt?: Date;
  rejectedAt?: Date;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MembershipApplicationRow = Omit<MembershipApplicationDoc, '_id'> & { id: string };

/** 010-1234-5678 포맷으로 정규화. 숫자가 11자리가 아니면 null 반환. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('010')) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function toRow(doc: MembershipApplicationDoc & { _id: ObjectId }): MembershipApplicationRow {
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

export async function createApplication(data: {
  applicantType: MembershipApplicantType;
  name: string;
  phone: string;
  ip?: string;
  userAgent?: string;
}): Promise<MembershipApplicationRow> {
  const db = await getDb('gomijoshua');
  const now = new Date();
  const doc: MembershipApplicationDoc = {
    applicantType: data.applicantType,
    name: data.name.trim(),
    phone: data.phone,
    status: 'pending',
    ip: data.ip,
    userAgent: data.userAgent,
    appliedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db
    .collection<MembershipApplicationDoc>(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .insertOne(doc as MembershipApplicationDoc & { _id: ObjectId });
  return toRow({ ...doc, _id: result.insertedId } as MembershipApplicationDoc & { _id: ObjectId });
}

export async function listApplications(opts: {
  status?: MembershipApplicationStatus;
  search?: string;
  limit?: number;
}): Promise<{ applications: MembershipApplicationRow[]; pendingCount: number }> {
  const db = await getDb('gomijoshua');
  const col = db.collection<MembershipApplicationDoc>(MEMBERSHIP_APPLICATIONS_COLLECTION);

  const filter: Record<string, unknown> = {};
  if (opts.status) filter.status = opts.status;
  if (opts.search) {
    const re = { $regex: opts.search, $options: 'i' };
    filter.$or = [{ name: re }, { phone: re }];
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  const docs = await col.find(filter).sort({ appliedAt: -1 }).limit(limit).toArray();
  const pendingCount = await col.countDocuments({ status: 'pending' });

  return {
    applications: docs.map((d) => toRow(d as MembershipApplicationDoc & { _id: ObjectId })),
    pendingCount,
  };
}

export async function getApplication(id: string): Promise<MembershipApplicationRow | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const doc = await db
    .collection<MembershipApplicationDoc>(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .findOne({ _id: oid } as unknown as MembershipApplicationDoc);
  if (!doc) return null;
  return toRow(doc as MembershipApplicationDoc & { _id: ObjectId });
}

export async function updateApplicationStatus(
  id: string,
  nextStatus: MembershipApplicationStatus | 'updateMemo',
  adminMemo?: string,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }

  const now = new Date();
  const $set: Record<string, unknown> = { updatedAt: now };

  if (nextStatus === 'contacted') {
    $set.status = 'contacted';
    $set.contactedAt = now;
  } else if (nextStatus === 'completed') {
    $set.status = 'completed';
    $set.completedAt = now;
  } else if (nextStatus === 'rejected') {
    $set.status = 'rejected';
    $set.rejectedAt = now;
  } else if (nextStatus === 'pending') {
    $set.status = 'pending';
  }

  if (adminMemo !== undefined) $set.adminMemo = adminMemo;

  const result = await db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .updateOne({ _id: oid }, { $set });
  return result.modifiedCount > 0;
}

export async function deleteApplication(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }
  const result = await db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .deleteOne({ _id: oid });
  return result.deletedCount > 0;
}

export async function countPendingApplications(): Promise<number> {
  const db = await getDb('gomijoshua');
  return db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .countDocuments({ status: 'pending' });
}

/** 동일 전화번호로 최근 24시간 내 신청이 있는지 확인 */
export async function hasRecentApplicationByPhone(phone: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const doc = await db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .findOne({ phone, appliedAt: { $gte: since } });
  return !!doc;
}

/** 동일 IP로 최근 1시간 내 신청 건수 */
export async function countRecentApplicationsByIp(ip: string): Promise<number> {
  const db = await getDb('gomijoshua');
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .countDocuments({ ip, appliedAt: { $gte: since } });
}
