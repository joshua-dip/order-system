/**
 * Q&A 분석 페이지용 thread store.
 *
 * - 컬렉션: `qna_threads`
 * - 비로그인 누구나 질문 작성 가능 (IP rate-limit), admin만 답변·status 변경.
 * - 본인 식별 토큰: 작성 시 plaintext UUID 발급 → 응답에 1회 노출, DB에는 sha256 해시만.
 * - 답변은 임베드 (1지문/1문장당 답변이 작아 단순).
 */

import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export const QNA_THREADS_COLLECTION = 'qna_threads';

export type QnaThreadStatus = 'open' | 'answered' | 'hidden';
export type QnaAskerRole = 'guest' | 'admin';

export interface QnaAnswer {
  body: string;
  author: { name: string; role: 'admin'; userId: string };
  createdAt: Date;
  updatedAt?: Date;
}

export interface QnaThreadDoc {
  _id?: ObjectId;
  passageId: ObjectId;
  /** 검색·관리용 비정규화 */
  textbook: string;
  /** 0-based, -1 = 지문 전체에 대한 질문 */
  sentenceIndex: number;
  asker: {
    /** 2~20자 (비로그인 익명용 또는 admin 표시명) */
    nickname: string;
    role: QnaAskerRole;
    /** 로그인 admin이 직접 질문할 때만 */
    userId?: string;
    ip?: string;
    userAgent?: string;
  };
  /** 비로그인 본인 식별용 sha256(token). plaintext 는 작성자 브라우저에만 저장. */
  ownerTokenHash?: string;
  /** 1~500자 */
  question: string;
  /** 단어/구 클릭으로 부착한 인용 (0~80자) */
  selectedText?: string;
  status: QnaThreadStatus;
  answers: QnaAnswer[];
  createdAt: Date;
  updatedAt: Date;
}

/** API 응답·렌더링에 쓰는 plain row (ObjectId → string) */
export interface QnaThreadRow {
  id: string;
  passageId: string;
  textbook: string;
  sentenceIndex: number;
  asker: {
    nickname: string;
    role: QnaAskerRole;
    /** admin 등 식별 필요 시. guest 면 undefined */
    userId?: string;
  };
  question: string;
  selectedText?: string;
  status: QnaThreadStatus;
  answers: QnaAnswer[];
  createdAt: string;
  updatedAt: string;
  /** 클라이언트가 본인 글 식별·삭제 권한 표시에 사용. POST 응답 1회만 노출. */
  ownerToken?: string;
}

/** ip/userAgent 같은 민감 정보는 응답에서 제외하고 row 변환. */
function toRow(doc: QnaThreadDoc & { _id: ObjectId }): QnaThreadRow {
  return {
    id: doc._id.toString(),
    passageId: doc.passageId.toString(),
    textbook: doc.textbook,
    sentenceIndex: doc.sentenceIndex,
    asker: {
      nickname: doc.asker.nickname,
      role: doc.asker.role,
      userId: doc.asker.userId,
    },
    question: doc.question,
    selectedText: doc.selectedText,
    status: doc.status,
    answers: doc.answers ?? [],
    createdAt: (doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt)).toISOString(),
    updatedAt: (doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt)).toISOString(),
  };
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * 본인 토큰 해시 비교 (timing-safe).
 *
 * 길이가 다르면 즉시 false — timingSafeEqual 은 buffer 길이가 다르면 throw.
 */
export function verifyOwnerToken(plaintextToken: string | undefined, hash: string | undefined): boolean {
  if (!plaintextToken || !hash) return false;
  const candidate = sha256Hex(plaintextToken);
  if (candidate.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

let indexesEnsured = false;
async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  const db = await getDb('gomijoshua');
  const col = db.collection(QNA_THREADS_COLLECTION);
  await Promise.all([
    col.createIndex({ passageId: 1, sentenceIndex: 1, createdAt: -1 }),
    col.createIndex({ status: 1, createdAt: -1 }),
    col.createIndex({ 'asker.ip': 1, createdAt: -1 }),
  ]);
  indexesEnsured = true;
}

export interface CreateThreadInput {
  passageId: string;
  textbook: string;
  sentenceIndex: number;
  nickname: string;
  question: string;
  selectedText?: string;
  asker: {
    role: QnaAskerRole;
    userId?: string;
    ip?: string;
    userAgent?: string;
  };
}

/**
 * 새 thread 작성.
 *
 * - guest 인 경우 plaintext ownerToken UUID 발급 → 응답에 1회 노출, DB 에는 sha256 해시만.
 * - admin 작성은 ownerToken 발급 안 함 (자기 자신을 항상 식별 가능).
 */
export async function createThread(input: CreateThreadInput): Promise<QnaThreadRow> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');

  let passageOid: ObjectId;
  try {
    passageOid = new ObjectId(input.passageId);
  } catch {
    throw new Error('Invalid passageId');
  }

  const now = new Date();
  const ownerToken = input.asker.role === 'guest' ? randomUUID() : undefined;

  const doc: QnaThreadDoc = {
    passageId: passageOid,
    textbook: input.textbook,
    sentenceIndex: input.sentenceIndex,
    asker: {
      nickname: input.nickname.trim(),
      role: input.asker.role,
      userId: input.asker.userId,
      ip: input.asker.ip,
      userAgent: input.asker.userAgent,
    },
    ownerTokenHash: ownerToken ? sha256Hex(ownerToken) : undefined,
    question: input.question.trim(),
    selectedText: input.selectedText?.trim() || undefined,
    status: 'open',
    answers: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await db
    .collection<QnaThreadDoc>(QNA_THREADS_COLLECTION)
    .insertOne(doc as QnaThreadDoc & { _id: ObjectId });

  const row = toRow({ ...doc, _id: result.insertedId } as QnaThreadDoc & { _id: ObjectId });
  if (ownerToken) row.ownerToken = ownerToken;
  return row;
}

export async function getThread(id: string): Promise<QnaThreadDoc & { _id: ObjectId } | null> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const doc = await db
    .collection<QnaThreadDoc>(QNA_THREADS_COLLECTION)
    .findOne({ _id: oid } as Partial<QnaThreadDoc>);
  return (doc as (QnaThreadDoc & { _id: ObjectId }) | null) ?? null;
}

/**
 * 특정 지문의 thread 목록. 학생 화면에서 hidden 은 제외.
 *
 * 정렬: sentenceIndex asc → createdAt desc.
 */
export async function listThreadsByPassage(
  passageId: string,
  opts?: { includeHidden?: boolean },
): Promise<QnaThreadRow[]> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(passageId);
  } catch {
    return [];
  }
  const filter: Record<string, unknown> = { passageId: oid };
  if (!opts?.includeHidden) filter.status = { $ne: 'hidden' as QnaThreadStatus };
  const docs = await db
    .collection<QnaThreadDoc>(QNA_THREADS_COLLECTION)
    .find(filter as Partial<QnaThreadDoc>)
    .sort({ sentenceIndex: 1, createdAt: -1 })
    .toArray();
  return docs.map((d) => toRow(d as QnaThreadDoc & { _id: ObjectId }));
}

/** admin 트리아지용 — 최근 N건, status 필터. */
export async function listRecentThreads(opts: {
  status?: QnaThreadStatus | 'all';
  limit?: number;
}): Promise<QnaThreadRow[]> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  const filter: Record<string, unknown> = {};
  if (opts.status && opts.status !== 'all') filter.status = opts.status;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const docs = await db
    .collection<QnaThreadDoc>(QNA_THREADS_COLLECTION)
    .find(filter as Partial<QnaThreadDoc>)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => toRow(d as QnaThreadDoc & { _id: ObjectId }));
}

/** 동일 IP 의 최근 1시간 내 thread 작성 건수. POST rate-limit 용. */
export async function countRecentThreadsByIp(ip: string): Promise<number> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return db
    .collection(QNA_THREADS_COLLECTION)
    .countDocuments({ 'asker.ip': ip, createdAt: { $gte: since } });
}

/** admin: status 직접 변경 (hidden 처리, 복구 등). */
export async function updateThreadStatus(id: string, status: QnaThreadStatus): Promise<boolean> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }
  const result = await db.collection(QNA_THREADS_COLLECTION).updateOne(
    { _id: oid },
    { $set: { status, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0 || result.matchedCount > 0;
}

/** admin 삭제 (실제 deleteOne). owner 가 답변 없는 글을 지울 때도 같은 경로. */
export async function deleteThread(id: string): Promise<boolean> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }
  const result = await db.collection(QNA_THREADS_COLLECTION).deleteOne({ _id: oid });
  return result.deletedCount > 0;
}

/**
 * admin 답변 작성. 작성 후 thread status → 'answered'.
 *
 * 반환: 갱신된 thread row (없으면 null).
 */
export async function addAnswer(
  threadId: string,
  answer: { body: string; author: { name: string; userId: string } },
): Promise<QnaThreadRow | null> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(threadId);
  } catch {
    return null;
  }
  const now = new Date();
  const entry: QnaAnswer = {
    body: answer.body.trim(),
    author: { name: answer.author.name, role: 'admin', userId: answer.author.userId },
    createdAt: now,
  };
  const result = await db.collection<QnaThreadDoc>(QNA_THREADS_COLLECTION).findOneAndUpdate(
    { _id: oid } as Partial<QnaThreadDoc>,
    {
      $push: { answers: entry } as Record<string, unknown>,
      $set: { status: 'answered' as QnaThreadStatus, updatedAt: now },
    },
    { returnDocument: 'after' },
  );
  const doc = (result as unknown as { value?: QnaThreadDoc & { _id: ObjectId } } | null)?.value
    ?? (result as unknown as QnaThreadDoc & { _id: ObjectId } | null);
  if (!doc) return null;
  return toRow(doc);
}

/**
 * admin 답변 삭제. 삭제 후 답변이 0개가 되면 status → 'open' 으로 되돌림.
 *
 * answerIdx: 0-based 인덱스 (현재 answers 배열 순서 기준).
 */
export async function deleteAnswer(threadId: string, answerIdx: number): Promise<boolean> {
  await ensureIndexes();
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(threadId);
  } catch {
    return false;
  }
  const col = db.collection<QnaThreadDoc>(QNA_THREADS_COLLECTION);
  const thread = await col.findOne({ _id: oid } as Partial<QnaThreadDoc>);
  if (!thread) return false;
  const answers = thread.answers ?? [];
  if (answerIdx < 0 || answerIdx >= answers.length) return false;
  const next = [...answers.slice(0, answerIdx), ...answers.slice(answerIdx + 1)];
  const nextStatus: QnaThreadStatus = next.length === 0
    ? (thread.status === 'answered' ? 'open' : thread.status)
    : thread.status;
  const result = await col.updateOne(
    { _id: oid } as Partial<QnaThreadDoc>,
    { $set: { answers: next, status: nextStatus, updatedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}
