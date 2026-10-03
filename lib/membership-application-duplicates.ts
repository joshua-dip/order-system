import { ObjectId, type Db } from 'mongodb';
import { MEMBERSHIP_APPLICATIONS_COLLECTION } from '@/lib/membership-applications-store';

/**
 * 가입 신청 중복 판정.
 *
 * 같은 전화번호로 다시 신청이 들어오는 경우가 두 가지 있다.
 *  - 이미 회원: 계정이 만들어졌는데(로그인 ID = 전화번호) 모르고 또 신청한다.
 *  - 이미 신청: 처리 대기·연락완료 중인 신청서가 있는데 기다리다 못해 또 신청한다.
 * 신청 단계에서는 막고 안내하고, 이미 쌓인 중복은 관리자 화면에서 「신규」로 세지 않는다.
 *
 * 처리 완료·거절된 신청서는 전화번호가 마스킹돼 번호로 찾을 수 없다 — 그래서 「이미 회원」은
 * 신청서가 아니라 users.loginId 로 본다.
 */

export const OPEN_APPLICATION_STATUSES = ['pending', 'contacted'] as const;

export const phoneDigits = (phone: string): string => phone.replace(/\D/g, '');

export type ExistingForPhone = { member: boolean; openApplicationId: string | null };

export async function findExistingForPhone(db: Db, normalizedPhone: string): Promise<ExistingForPhone> {
  const [user, open] = await Promise.all([
    db.collection('users').findOne({ loginId: phoneDigits(normalizedPhone) }, { projection: { _id: 1 } }),
    db
      .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
      .findOne({ phone: normalizedPhone, status: { $in: [...OPEN_APPLICATION_STATUSES] } }, { projection: { _id: 1 }, sort: { appliedAt: 1 } }),
  ]);
  return { member: !!user, openApplicationId: open ? String(open._id) : null };
}

/** 기다리다 또 신청한 횟수를 먼저 접수된 신청서에 남긴다 — 관리자가 급한 건을 알아보도록 */
export async function bumpRetryAttempt(db: Db, applicationId: string): Promise<void> {
  await db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(applicationId) },
      { $inc: { retryCount: 1 }, $set: { lastRetryAt: new Date() } },
    )
    .catch(() => {});
}

export type DuplicateInfo =
  /** 이 번호로 이미 계정이 있다 */
  | { kind: 'member'; account: { id: string; name: string; loginId: string } }
  /** 같은 번호의 먼저 접수된 신청서가 아직 처리 중이다 */
  | { kind: 'repeat'; ofId: string };

export type DuplicateAnalysis = {
  byId: Map<string, DuplicateInfo>;
  /** 처리 대기·연락완료 중 중복이 아닌 것 = 실제로 사람이 처리할 건수 */
  realUnhandled: number;
  /** 그중 상태가 pending 인 중복 건수 (「대기 중」 카드에서 뺀다) */
  duplicatePending: number;
};

export async function analyzeUnhandledDuplicates(db: Db): Promise<DuplicateAnalysis> {
  const docs = await db
    .collection(MEMBERSHIP_APPLICATIONS_COLLECTION)
    .find({ status: { $in: [...OPEN_APPLICATION_STATUSES] } }, { projection: { phone: 1, status: 1, appliedAt: 1 } })
    .sort({ appliedAt: 1 })
    .toArray();

  const digitsOf = (d: Record<string, unknown>) => phoneDigits(String(d.phone ?? ''));
  const phones = [...new Set(docs.map(digitsOf).filter((x) => x.length === 11))];
  const users = phones.length
    ? await db
        .collection('users')
        .find({ loginId: { $in: phones } }, { projection: { loginId: 1, name: 1 } })
        .toArray()
    : [];
  const userBy = new Map(users.map((u) => [String(u.loginId), { id: String(u._id), name: String(u.name ?? ''), loginId: String(u.loginId) }]));

  const byId = new Map<string, DuplicateInfo>();
  const firstOf = new Map<string, string>();
  let duplicatePending = 0;
  for (const d of docs) {
    const digits = digitsOf(d);
    const id = String(d._id);
    const account = userBy.get(digits);
    if (account) byId.set(id, { kind: 'member', account });
    else if (firstOf.has(digits)) byId.set(id, { kind: 'repeat', ofId: firstOf.get(digits)! });
    else firstOf.set(digits, id);
    if (byId.has(id) && d.status === 'pending') duplicatePending += 1;
  }
  return { byId, realUnhandled: docs.length - byId.size, duplicatePending };
}
