import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { getDb } from './mongodb';
import {
  USER_VOCABULARIES_COLLECTION,
  type UserVocabularyDoc,
  type UserVocabularyInsert,
  type UserVocabularySerialized,
  type VocabularyPackageType,
  VOCABULARY_POINTS_PER_PASSAGE,
} from './vocabulary-library-types';
import type { VocabularyEntry } from './passage-analyzer-types';
import { passageAnalysisFileNameForPassageId } from './passage-analyzer-types';
import { isFreeVocabularyMockExamTextbook } from './mock-exam-key';
import type { PassageStateStored } from './passage-analyzer-types';
import { recordPointLedger } from './point-ledger';

/* ── 직렬화 헬퍼 ── */

export function serializeVocabulary(doc: UserVocabularyDoc): UserVocabularySerialized {
  return {
    _id: doc._id.toHexString(),
    login_id: doc.login_id,
    passage_id: doc.passage_id.toHexString(),
    order_id: doc.order_id.toHexString(),
    textbook: doc.textbook,
    chapter: doc.chapter,
    number: doc.number,
    display_label: doc.display_label,
    package_type: doc.package_type,
    vocabulary_list: doc.vocabulary_list,
    original_snapshot: doc.original_snapshot,
    points_used: doc.points_used,
    order_number: doc.order_number,
    purchased_at: doc.purchased_at.toISOString(),
    last_edited_at: doc.last_edited_at.toISOString(),
  };
}

/* ── 내 단어장 목록 (삭제된 항목 제외) ── */

export async function listMyVocabularies(userId: ObjectId): Promise<UserVocabularySerialized[]> {
  const db = await getDb('gomijoshua');
  const docs = (await db
    .collection(USER_VOCABULARIES_COLLECTION)
    .find({ user_id: userId, deleted_at: null })
    .sort({ last_edited_at: -1 })
    .toArray()) as UserVocabularyDoc[];

  return docs.map(serializeVocabulary);
}

/* ── 특정 단어장 조회 ── */

export async function getMyVocabulary(
  id: string,
  userId: ObjectId,
): Promise<UserVocabularySerialized | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const doc = (await db
    .collection(USER_VOCABULARIES_COLLECTION)
    .findOne({ _id: oid, user_id: userId, deleted_at: null })) as UserVocabularyDoc | null;

  return doc ? serializeVocabulary(doc) : null;
}

/* ── 단어 목록 저장 (편집) ── */

export async function saveMyVocabulary(
  id: string,
  userId: ObjectId,
  vocabularyList: VocabularyEntry[],
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const result = await db.collection(USER_VOCABULARIES_COLLECTION).updateOne(
    { _id: oid, user_id: userId, deleted_at: null },
    { $set: { vocabulary_list: vocabularyList, last_edited_at: new Date() } },
  );
  return result.matchedCount > 0;
}

/* ── 원본으로 되돌리기 ── */

export async function resetMyVocabulary(
  id: string,
  userId: ObjectId,
): Promise<UserVocabularySerialized | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const doc = (await db
    .collection(USER_VOCABULARIES_COLLECTION)
    .findOne({ _id: oid, user_id: userId, deleted_at: null })) as UserVocabularyDoc | null;

  if (!doc) return null;

  await db.collection(USER_VOCABULARIES_COLLECTION).updateOne(
    { _id: oid },
    {
      $set: {
        vocabulary_list: doc.original_snapshot,
        last_edited_at: new Date(),
      },
    },
  );

  return serializeVocabulary({ ...doc, vocabulary_list: doc.original_snapshot, last_edited_at: new Date() });
}

/* ── 소프트 딜리트 ── */

export async function softDeleteMyVocabulary(
  id: string,
  userId: ObjectId,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const result = await db.collection(USER_VOCABULARIES_COLLECTION).updateOne(
    { _id: oid, user_id: userId, deleted_at: null },
    { $set: { deleted_at: new Date() } },
  );
  return result.matchedCount > 0;
}

/* ── 이미 보유한 지문 id 집합 조회 ── */

export async function getOwnedPassageIds(
  userId: ObjectId,
  db: Db,
): Promise<Set<string>> {
  const docs = (await db
    .collection(USER_VOCABULARIES_COLLECTION)
    .find({ user_id: userId, deleted_at: null })
    .project({ passage_id: 1 })
    .toArray()) as { passage_id: ObjectId }[];
  return new Set(docs.map((d) => d.passage_id.toHexString()));
}

/* ── 구매 (포인트 차감 + 사본 생성) ── */

export type PurchaseItem = {
  passage_id: string;
  package_type: VocabularyPackageType;
};

export type PurchaseResult = {
  ok: boolean;
  error?: string;
  first_id?: string;
  inserted_count?: number;
};

export async function purchaseVocabularies(
  userId: ObjectId,
  loginId: string,
  items: PurchaseItem[],
  orderNumber: string,
  orderId: ObjectId,
): Promise<PurchaseResult> {
  const db = await getDb('gomijoshua');

  if (items.length === 0) return { ok: false, error: '선택된 지문이 없습니다.' };

  // 이미 보유한 지문 확인
  const ownedSet = await getOwnedPassageIds(userId, db);
  const duplicates = items.filter((i) => ownedSet.has(i.passage_id));
  if (duplicates.length > 0) {
    return {
      ok: false,
      error: `이미 보유한 지문이 ${duplicates.length}개 포함되어 있습니다. 다시 선택해 주세요.`,
    };
  }

  // 지문 메타 조회
  const passageOids = items.map((i) => new ObjectId(i.passage_id));
  type PRow = { _id: ObjectId; textbook?: string; chapter?: string; number?: string; order?: number };
  const passages = (await db
    .collection('passages')
    .find({ _id: { $in: passageOids } })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, order: 1 })
    .toArray()) as PRow[];

  const passageMap = new Map<string, PRow>();
  for (const p of passages) passageMap.set(p._id.toHexString(), p);

  // passage_analyses에서 단어장 원본 로드
  const fileNames = passages.map((p) => passageAnalysisFileNameForPassageId(p._id.toHexString()));
  const analyses = await db
    .collection('passage_analyses')
    .find({ fileName: { $in: fileNames } })
    .project({ fileName: 1, passageStates: 1 })
    .toArray();

  const vocabByFile = new Map<string, VocabularyEntry[]>();
  for (const a of analyses) {
    const fn = String((a as { fileName?: string }).fileName || '');
    const main = (a as { passageStates?: { main?: PassageStateStored } }).passageStates?.main;
    const list = Array.isArray(main?.vocabularyList) ? main!.vocabularyList! : [];
    vocabByFile.set(fn, list);
  }

  // 사본 문서 생성
  const now = new Date();
  const inserts: UserVocabularyInsert[] = [];
  for (const item of items) {
    const p = passageMap.get(item.passage_id);
    if (!p) continue;
    const fn = passageAnalysisFileNameForPassageId(p._id.toHexString());
    const vocabList = vocabByFile.get(fn) ?? [];
    const ch = p.chapter ?? '';
    const num = p.number ?? '';
    const displayLabel = ([ch, num].filter(Boolean).join(' ')) || (p.textbook ?? '');

    const passageTb = p.textbook ?? '';
    const pointsUsed = isFreeVocabularyMockExamTextbook(passageTb) ? 0 : VOCABULARY_POINTS_PER_PASSAGE;

    inserts.push({
      user_id: userId,
      login_id: loginId,
      passage_id: p._id,
      textbook: passageTb,
      chapter: p.chapter,
      number: p.number,
      display_label: displayLabel,
      package_type: item.package_type,
      vocabulary_list: vocabList,
      original_snapshot: vocabList,
      points_used: pointsUsed,
      order_id: orderId,
      order_number: orderNumber,
      purchased_at: now,
      last_edited_at: now,
      deleted_at: null,
    });
  }

  if (inserts.length === 0) {
    return { ok: false, error: '유효한 지문을 찾을 수 없습니다.' };
  }

  const result = await db.collection(USER_VOCABULARIES_COLLECTION).insertMany(inserts);
  const firstId = Object.values(result.insertedIds)[0]?.toHexString();

  // point_ledger 기록
  const totalPoints = inserts.reduce((s, i) => s + i.points_used, 0);
  const userDoc = await db
    .collection('users')
    .findOne({ _id: userId }, { projection: { points: 1 } });
  const userDocPoints = (userDoc as unknown as { points?: number } | null)?.points;
  const balanceAfter = typeof userDocPoints === 'number' ? userDocPoints : 0;

  await recordPointLedger(db, {
    userId,
    delta: -totalPoints,
    balanceAfter,
    kind: 'order_spend',
    meta: { orderNumber, orderId: orderId.toHexString(), flow: 'vocabulary', itemCount: inserts.length },
  }).catch((e) => console.error('point_ledger 기록 실패:', e));

  return { ok: true, first_id: firstId, inserted_count: inserts.length };
}

/** 관리자 목록: 원본 스냅샷 대비 사용자 편집 여부 */
export function vocabularyHasCustomEdit(
  list: VocabularyEntry[],
  original: VocabularyEntry[],
): boolean {
  return JSON.stringify(list) !== JSON.stringify(original);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type AdminVocabularyListItem = {
  id: string;
  user_id: string;
  login_id: string;
  passage_id: string;
  textbook: string;
  chapter?: string;
  number?: string;
  display_label: string;
  package_type: VocabularyPackageType;
  points_used: number;
  order_number: string;
  purchased_at: string;
  last_edited_at: string;
  entry_count: number;
  has_custom_edit: boolean;
};

type VocabAdminProjection = {
  _id: ObjectId;
  user_id: ObjectId;
  login_id: string;
  passage_id: ObjectId;
  textbook?: string;
  chapter?: string;
  number?: string;
  display_label: string;
  package_type: VocabularyPackageType;
  points_used: number;
  order_number: string;
  purchased_at: Date;
  last_edited_at: Date;
  vocabulary_list: VocabularyEntry[];
  original_snapshot: VocabularyEntry[];
};

/** 관리자: 전체 또는 특정 회원 단어장 구매·편집 메타 (본문 리스트는 내려주지 않음) */
export async function listVocabulariesForAdmin(opts: {
  userObjectId?: ObjectId;
  loginIdContains?: string;
  limit: number;
  skip: number;
}): Promise<{ items: AdminVocabularyListItem[]; total: number }> {
  const db = await getDb('gomijoshua');
  const filter: Record<string, unknown> = { deleted_at: null };
  if (opts.userObjectId) filter.user_id = opts.userObjectId;
  const q = opts.loginIdContains?.trim();
  if (q) filter.login_id = { $regex: escapeRegExp(q), $options: 'i' };

  const lim = Math.min(200, Math.max(1, opts.limit));
  const sk = Math.max(0, opts.skip);

  const col = db.collection(USER_VOCABULARIES_COLLECTION);
  const total = await col.countDocuments(filter);
  const docs = (await col
    .find(filter)
    .sort({ purchased_at: -1 })
    .skip(sk)
    .limit(lim)
    .project({
      user_id: 1,
      login_id: 1,
      passage_id: 1,
      textbook: 1,
      chapter: 1,
      number: 1,
      display_label: 1,
      package_type: 1,
      points_used: 1,
      order_number: 1,
      purchased_at: 1,
      last_edited_at: 1,
      vocabulary_list: 1,
      original_snapshot: 1,
    })
    .toArray()) as VocabAdminProjection[];

  const items: AdminVocabularyListItem[] = docs.map((doc) => {
    const list = Array.isArray(doc.vocabulary_list) ? doc.vocabulary_list : [];
    const orig = Array.isArray(doc.original_snapshot) ? doc.original_snapshot : [];
    return {
      id: doc._id.toHexString(),
      user_id: doc.user_id.toHexString(),
      login_id: doc.login_id,
      passage_id: doc.passage_id.toHexString(),
      textbook: doc.textbook ?? '',
      chapter: doc.chapter,
      number: doc.number,
      display_label: doc.display_label,
      package_type: doc.package_type,
      points_used: doc.points_used,
      order_number: doc.order_number,
      purchased_at: doc.purchased_at.toISOString(),
      last_edited_at: doc.last_edited_at.toISOString(),
      entry_count: list.length,
      has_custom_edit: vocabularyHasCustomEdit(list, orig),
    };
  });

  return { items, total };
}
