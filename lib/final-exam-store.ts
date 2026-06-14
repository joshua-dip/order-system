import { randomBytes } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { matchGeneratedQuestionOptionTypeEnglish } from '@/lib/question-count-validation';
import type { FinalExamQuestion } from '@/lib/final-exam-html';

/**
 * 파이널 예비 모의고사 — 즉시 발급 잡(final_exam_jobs).
 *
 * 흐름:
 *  1) POST /api/my/final-exams: 범위(selectedSources)×유형별로 status=완료 문항을 선택해 잡 생성,
 *     포인트 차감. 부족분(shortBy>0)이 있으면 UV 주문 자동 생성 → status 'awaiting_admin'.
 *  2) 관리자가 부족 문항을 제작·완료하면, 목록/다운로드 조회 시 refillJobShortages 가
 *     lazy 하게 채워 'ready' 로 전환.
 *  3) GET /api/my/final-exams/[id]/download 가 잡의 questionIds 로 시험지 PDF 렌더.
 */

export const FINAL_EXAM_JOBS_COLLECTION = 'final_exam_jobs';

export type FinalExamJobStatus = 'ready' | 'awaiting_admin';

export interface FinalExamJobItem {
  sourceKey: string;
  passageId: ObjectId;
  type: string;
  requested: number;
  /** 배정된 generated_questions._id (요청 수만큼 차면 shortBy=0) */
  questionIds: ObjectId[];
  shortBy: number;
}

export interface FinalExamJobDoc {
  _id?: ObjectId;
  loginId: string;
  userId: ObjectId;
  title: string;
  scopeSummary: string;
  selectedTypes: string[];
  questionsPerTypeMap: Record<string, number>;
  items: FinalExamJobItem[];
  totalRequested: number;
  totalAssigned: number;
  pointsCharged: number;
  status: FinalExamJobStatus;
  /** 부족분 제작 요청으로 생성된 UV 주문 */
  shortageOrderId?: string;
  shortageOrderNumber?: string;
  /** QR 채점용 공개 토큰 (시험지 1장 단위) */
  gradeToken?: string;
  /** 오답 재학습 세트 — 원본(구매) 잡 id + 회차(1·2) */
  parentJobId?: string;
  retryIndex?: number;
  createdAt: Date;
  updatedAt: Date;
  readyAt?: Date;
}

/* ── QR 채점 ────────────────────────────────────────────────────────────── */

export const FINAL_EXAM_GRADINGS_COLLECTION = 'final_exam_gradings';

export interface FinalExamGradingAnswer {
  num: number;
  questionId: ObjectId;
  type: string;
  sourceKey: string;
  /** 학생이 고른 답 (정규화된 동그라미 문자열, 예: "③" / "①③") */
  chosen: string;
  correct: string;
  isCorrect: boolean;
}

export interface FinalExamGradingDoc {
  _id?: ObjectId;
  jobId: ObjectId;
  /** 잡 소유자 loginId (조회 권한용) */
  ownerLoginId: string;
  studentName: string;
  answers: FinalExamGradingAnswer[];
  score: number;
  total: number;
  byType: { type: string; correct: number; total: number }[];
  bySource: { sourceKey: string; correct: number; total: number }[];
  createdAt: Date;
}

export function generateGradeToken(): string {
  return randomBytes(12).toString('hex');
}

/** 토큰 없던 기존 잡에 lazy 발급 */
export async function ensureGradeToken(db: Db, job: FinalExamJobDoc): Promise<string> {
  if (typeof job.gradeToken === 'string' && job.gradeToken.length >= 16) return job.gradeToken;
  const token = generateGradeToken();
  await db
    .collection(FINAL_EXAM_JOBS_COLLECTION)
    .updateOne({ _id: job._id }, { $set: { gradeToken: token, updatedAt: new Date() } });
  job.gradeToken = token;
  return token;
}

export async function getFinalExamJobByToken(db: Db, token: string): Promise<FinalExamJobDoc | null> {
  const t = token.trim();
  if (!/^[a-f0-9]{16,64}$/i.test(t)) return null;
  return db.collection<FinalExamJobDoc>(FINAL_EXAM_JOBS_COLLECTION).findOne({ gradeToken: t });
}

/** 답안 정규화 — 동그라미 번호만 추려 정렬 (어법-고난도 복수 답 "①③" 비교용) */
export function normalizeCircledAnswer(raw: string): string {
  const chars = (raw ?? '').match(/[①②③④⑤]/g) ?? [];
  return [...new Set(chars)].sort().join('');
}

/**
 * 잡의 문항을 시험지 인쇄와 동일한 순서(유형 순 → 출처 순)로 로드.
 * 문항 번호가 인쇄본과 반드시 일치해야 하므로 PDF·채점 양쪽이 이 함수만 사용한다.
 */
export async function loadExamQuestions(db: Db, job: FinalExamJobDoc): Promise<FinalExamQuestion[]> {
  const ordered = [...job.items].sort((a, b) => {
    const t = finalExamTypeRank(a.type) - finalExamTypeRank(b.type);
    if (t !== 0) return t;
    return a.sourceKey.localeCompare(b.sourceKey, 'ko', { numeric: true });
  });
  const allIds: ObjectId[] = ordered.flatMap((it) => it.questionIds);
  const docs = await db
    .collection('generated_questions')
    .find({ _id: { $in: allIds } })
    .project<{
      _id: ObjectId;
      question_data?: {
        Question?: unknown;
        Paragraph?: unknown;
        Options?: unknown;
        CorrectAnswer?: unknown;
        Explanation?: unknown;
      };
    }>({ question_data: 1 })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const out: FinalExamQuestion[] = [];
  let num = 0;
  for (const it of ordered) {
    for (const qid of it.questionIds) {
      const d = byId.get(String(qid));
      if (!d) continue;
      const qd = d.question_data ?? {};
      num += 1;
      out.push({
        num,
        type: it.type,
        sourceKey: it.sourceKey,
        question: String(qd.Question ?? ''),
        paragraph: String(qd.Paragraph ?? ''),
        options: String(qd.Options ?? ''),
        correctAnswer: String(qd.CorrectAnswer ?? ''),
        explanation: String(qd.Explanation ?? ''),
        questionId: String(qid),
      });
    }
  }
  return out;
}

/** 시험지에 싣는 순서 — 실제 모의고사 유형 배열에 가깝게 고정 */
export const FINAL_EXAM_TYPE_ORDER = [
  '주장',
  '함의',
  '주제',
  '제목',
  '일치',
  '불일치',
  '어법',
  '어법-고난도',
  '어휘',
  '빈칸',
  '무관한문장',
  '순서',
  '삽입',
  '삽입-고난도',
  '요약',
] as const;

export function finalExamTypeRank(type: string): number {
  const i = (FINAL_EXAM_TYPE_ORDER as readonly string[]).indexOf(type);
  return i === -1 ? 999 : i;
}

/* ── 문항 선택 ───────────────────────────────────────────────────────────── */

export interface SelectScopeInput {
  /** passages.source_key 전체 라벨 목록 (UnifiedOrder selectedSources) */
  sourceKeys: string[];
  selectedTypes: string[];
  questionsPerTypeMap: Record<string, number>;
  /** 이 회원에게 이미 나간 문항을 우선 제외 */
  loginId: string;
}

export interface SelectScopeResult {
  items: FinalExamJobItem[];
  totalRequested: number;
  totalAssigned: number;
  totalShort: number;
  /** source_key 를 passages 에서 못 찾은 라벨 */
  missingSources: string[];
}

/** 이 회원의 기존 잡들에 배정된 문항 id 집합 (재출제 방지용) */
async function previouslyDeliveredIds(db: Db, loginId: string): Promise<Set<string>> {
  const prior = await db
    .collection(FINAL_EXAM_JOBS_COLLECTION)
    .find({ loginId })
    .project<{ items?: { questionIds?: ObjectId[] }[] }>({ 'items.questionIds': 1 })
    .toArray();
  const used = new Set<string>();
  for (const j of prior) {
    for (const it of j.items ?? []) {
      for (const id of it.questionIds ?? []) used.add(String(id));
    }
  }
  return used;
}

/**
 * 범위×유형별로 완료(검수 통과) 문항을 선택.
 * 같은 회원에게 이미 나간 문항은 후순위(미사용분 우선, 부족하면 재사용) —
 * 절대 재고가 모자랄 때만 shortBy 로 계산.
 */
export async function selectQuestionsForScope(
  db: Db,
  input: SelectScopeInput,
): Promise<SelectScopeResult> {
  const sourceKeys = [...new Set(input.sourceKeys.map((s) => s.trim()).filter(Boolean))];
  const passages = await db
    .collection('passages')
    .find({ source_key: { $in: sourceKeys } })
    .project<{ _id: ObjectId; source_key?: string }>({ _id: 1, source_key: 1 })
    .toArray();
  const bySource = new Map<string, ObjectId>();
  for (const p of passages) {
    const sk = typeof p.source_key === 'string' ? p.source_key.trim() : '';
    if (sk && !bySource.has(sk)) bySource.set(sk, p._id);
  }
  const missingSources = sourceKeys.filter((sk) => !bySource.has(sk));

  const usedBefore = await previouslyDeliveredIds(db, input.loginId);
  const gq = db.collection('generated_questions');
  const englishMatch = matchGeneratedQuestionOptionTypeEnglish();

  const items: FinalExamJobItem[] = [];
  let totalRequested = 0;
  let totalAssigned = 0;

  for (const sk of sourceKeys) {
    const passageId = bySource.get(sk);
    for (const type of input.selectedTypes) {
      const requested = Math.max(0, Math.floor(input.questionsPerTypeMap[type] ?? 0));
      if (requested <= 0) continue;
      totalRequested += requested;

      if (!passageId) {
        items.push({ sourceKey: sk, passageId: new ObjectId('0'.repeat(24)), type, requested, questionIds: [], shortBy: requested });
        continue;
      }

      const candidates = await gq
        .find({ passage_id: passageId, type, status: '완료', ...englishMatch })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .sort({ created_at: 1 })
        .toArray();

      const fresh: ObjectId[] = [];
      const reused: ObjectId[] = [];
      for (const c of candidates) {
        (usedBefore.has(String(c._id)) ? reused : fresh).push(c._id);
      }
      const picked = [...fresh, ...reused].slice(0, requested);
      totalAssigned += picked.length;
      items.push({
        sourceKey: sk,
        passageId,
        type,
        requested,
        questionIds: picked,
        shortBy: requested - picked.length,
      });
    }
  }

  return {
    items,
    totalRequested,
    totalAssigned,
    totalShort: totalRequested - totalAssigned,
    missingSources,
  };
}

/* ── CRUD ───────────────────────────────────────────────────────────────── */

export async function insertFinalExamJob(db: Db, doc: Omit<FinalExamJobDoc, '_id'>): Promise<string> {
  const r = await db.collection(FINAL_EXAM_JOBS_COLLECTION).insertOne(doc);
  return String(r.insertedId);
}

export async function listFinalExamJobs(db: Db, loginId: string): Promise<FinalExamJobDoc[]> {
  return db
    .collection<FinalExamJobDoc>(FINAL_EXAM_JOBS_COLLECTION)
    .find({ loginId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}

export async function getFinalExamJob(db: Db, id: string, loginId: string): Promise<FinalExamJobDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  return db
    .collection<FinalExamJobDoc>(FINAL_EXAM_JOBS_COLLECTION)
    .findOne({ _id: new ObjectId(id), loginId });
}

/* ── 부족분 → 관리자 요청(UV 주문 자동 생성) ──────────────────────────── */

/**
 * 부족 문항 제작 요청 주문 생성 + Slack 알림. 잡 문서에 주문번호를 기록.
 * (포인트는 잡 생성 시 이미 차감되었으므로 주문서에 입금 불필요 명시)
 */
export async function createFinalExamShortageOrder(
  db: Db,
  input: {
    jobId: string;
    loginId: string;
    userName?: string;
    items: FinalExamJobItem[];
    /** 주문서 머리에 붙일 설명 (예: '오답 재학습 세트') */
    contextLabel?: string;
    selectedTypes?: string[];
    questionsPerTypeMap?: Record<string, number>;
  },
): Promise<string | null> {
  const shortItems = input.items.filter((it) => it.shortBy > 0);
  if (shortItems.length === 0) return null;
  const now = new Date();
  const label = input.contextLabel ?? '파이널 예비 모의고사';

  const orderText = [
    `=== ${label} 부족분 제작 요청 (자동 생성) ===`,
    '',
    `회원: ${input.loginId}${input.userName ? ` (${input.userName})` : ''}`,
    `즉시발급 잡 ID: ${input.jobId}`,
    '결제: 포인트로 이미 처리됨 — 별도 입금 불필요',
    '',
    '[ 부족 문항 ]',
    ...shortItems.map((it) => `· ${it.sourceKey} / ${it.type} — ${it.shortBy}문항 부족`),
    '',
    '※ 위 지문×유형의 변형문제를 제작·검수 완료 처리하면, 회원 다운로드 목록에서 자동으로 채워져 다운로드 가능해집니다.',
  ].join('\n');

  const counterColl = db.collection<{ _id: string; n: number }>('orderNumberCounters');
  const pad = (n: number, d = 2) => String(n).padStart(d, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const counterKey = `UV_${datePart}`;
  let orderNumber = '';
  for (let attempt = 0; attempt < 200; attempt++) {
    const updated = await counterColl.findOneAndUpdate(
      { _id: counterKey },
      { $inc: { n: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const n = updated && typeof updated.n === 'number' ? updated.n : attempt + 1;
    const candidate = `UV-${datePart}-${pad(n, 3)}`;
    const clash = await db.collection('orders').findOne({ orderNumber: candidate }, { projection: { _id: 1 } });
    if (!clash) { orderNumber = candidate; break; }
  }
  if (!orderNumber) {
    console.error('[final-exam] 부족분 주문번호 할당 실패 — jobId:', input.jobId);
    return null;
  }

  const orderRes = await db.collection('orders').insertOne({
    orderText,
    createdAt: now,
    source: 'gomijoshua',
    status: 'pending',
    orderNumber,
    loginId: input.loginId,
    orderMeta: {
      flow: 'unifiedVariant',
      version: 1,
      finalExamJobId: input.jobId,
      autoCreated: 'final_exam_shortage',
      shortageItems: shortItems.map((it) => ({ sourceKey: it.sourceKey, type: it.type, shortBy: it.shortBy })),
      ...(input.selectedTypes ? { selectedTypes: input.selectedTypes } : {}),
      ...(input.questionsPerTypeMap ? { questionsPerTypeMap: input.questionsPerTypeMap } : {}),
    },
  });
  await db.collection(FINAL_EXAM_JOBS_COLLECTION).updateOne(
    { _id: new ObjectId(input.jobId) },
    { $set: { shortageOrderId: String(orderRes.insertedId), shortageOrderNumber: orderNumber } },
  );

  const { notifySlackOrder } = await import('@/lib/slack');
  notifySlackOrder({
    orderText,
    orderId: String(orderRes.insertedId),
    orderNumber,
    flow: 'unifiedVariant',
    loginId: input.loginId,
    userName: input.userName,
  }).catch((e) => console.error('[final-exam] Slack 실패:', e));

  return orderNumber;
}

/* ── 오답 재학습 세트 선택 ─────────────────────────────────────────────── */

/** 원본 잡당 무료 재학습 세트 한도 */
export const FINAL_EXAM_FREE_RETRY_LIMIT = 2;

export async function countRetryJobs(db: Db, parentJobId: string): Promise<number> {
  return db.collection(FINAL_EXAM_JOBS_COLLECTION).countDocuments({ parentJobId });
}

/**
 * 오답 기반 재학습 문항 선택 — 틀린 문항당 새 문항 1개.
 *  1순위: 같은 지문 × 같은 유형의 미수령 문항
 *  2순위: 같은 유형 × 원본 시험 범위 내 다른 지문
 *  둘 다 없으면 그 (지문×유형)은 shortBy 로 남김 (부족분 주문 흐름).
 */
export async function selectRetryQuestions(
  db: Db,
  parentJob: FinalExamJobDoc,
  wrong: { sourceKey: string; type: string }[],
): Promise<SelectScopeResult> {
  const gq = db.collection('generated_questions');
  const englishMatch = matchGeneratedQuestionOptionTypeEnglish();
  const usedBefore = await previouslyDeliveredIds(db, parentJob.loginId);

  /* 원본 범위의 지문 매핑 (sourceKey → passageId) */
  const scopePassages = new Map<string, ObjectId>();
  for (const it of parentJob.items) {
    if (!scopePassages.has(it.sourceKey)) scopePassages.set(it.sourceKey, it.passageId);
  }

  /* (sourceKey|type) 별 필요 수 집계 */
  const needs = new Map<string, { sourceKey: string; type: string; count: number }>();
  for (const w of wrong) {
    const key = `${w.sourceKey}|${w.type}`;
    const cur = needs.get(key) ?? { sourceKey: w.sourceKey, type: w.type, count: 0 };
    cur.count += 1;
    needs.set(key, cur);
  }

  /* 이번 세트 안에서의 중복 배정 방지 */
  const taken = new Set<string>(usedBefore);
  const pickFrom = async (passageId: ObjectId, type: string, want: number): Promise<ObjectId[]> => {
    if (want <= 0) return [];
    const candidates = await gq
      .find({ passage_id: passageId, type, status: '완료', ...englishMatch })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .sort({ created_at: 1 })
      .toArray();
    const out: ObjectId[] = [];
    for (const c of candidates) {
      if (out.length >= want) break;
      if (!taken.has(String(c._id))) {
        out.push(c._id);
        taken.add(String(c._id));
      }
    }
    return out;
  };

  const items: FinalExamJobItem[] = [];
  let totalRequested = 0;
  let totalAssigned = 0;

  for (const need of needs.values()) {
    totalRequested += need.count;
    const passageId = scopePassages.get(need.sourceKey);
    const picked: ObjectId[] = passageId ? await pickFrom(passageId, need.type, need.count) : [];

    /* 2순위 폴백 — 같은 유형, 범위 내 다른 지문 */
    let remaining = need.count - picked.length;
    if (remaining > 0) {
      for (const [sk, pid] of scopePassages) {
        if (remaining <= 0) break;
        if (sk === need.sourceKey) continue;
        const extra = await pickFrom(pid, need.type, remaining);
        if (extra.length > 0) {
          /* 폴백 문항은 해당 지문의 item 으로 기록 (시험지 출처 표기 정확성) */
          items.push({
            sourceKey: sk,
            passageId: pid,
            type: need.type,
            requested: extra.length,
            questionIds: extra,
            shortBy: 0,
          });
          totalAssigned += extra.length;
          remaining -= extra.length;
        }
      }
    }

    items.push({
      sourceKey: need.sourceKey,
      passageId: passageId ?? new ObjectId('0'.repeat(24)),
      type: need.type,
      requested: picked.length + remaining,
      questionIds: picked,
      shortBy: remaining,
    });
    totalAssigned += picked.length;
  }

  return {
    items,
    totalRequested,
    totalAssigned,
    totalShort: totalRequested - totalAssigned,
    missingSources: [],
  };
}

/**
 * 부족분 lazy 채움 — awaiting_admin 잡의 shortBy>0 항목을 재조회해 채우고,
 * 전부 차면 status를 ready 로 전환. 변경이 있으면 DB 반영 후 갱신된 잡 반환.
 */
export async function refillJobShortages(db: Db, job: FinalExamJobDoc): Promise<FinalExamJobDoc> {
  if (job.status !== 'awaiting_admin') return job;
  const gq = db.collection('generated_questions');
  const englishMatch = matchGeneratedQuestionOptionTypeEnglish();

  /* 이 잡에 이미 배정된 id 는 제외 */
  const assigned = new Set<string>();
  for (const it of job.items) for (const id of it.questionIds) assigned.add(String(id));

  let changed = false;
  let totalAssigned = 0;
  for (const it of job.items) {
    if (it.shortBy > 0 && ObjectId.isValid(String(it.passageId))) {
      const candidates = await gq
        .find({ passage_id: it.passageId, type: it.type, status: '완료', ...englishMatch })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .sort({ created_at: 1 })
        .toArray();
      const extra: ObjectId[] = [];
      for (const c of candidates) {
        if (extra.length >= it.shortBy) break;
        if (!assigned.has(String(c._id))) {
          extra.push(c._id);
          assigned.add(String(c._id));
        }
      }
      if (extra.length > 0) {
        it.questionIds = [...it.questionIds, ...extra];
        it.shortBy = it.requested - it.questionIds.length;
        changed = true;
      }
    }
    totalAssigned += it.questionIds.length;
  }

  if (!changed) return job;

  const allFilled = job.items.every((it) => it.shortBy <= 0);
  const now = new Date();
  const update: Record<string, unknown> = {
    items: job.items,
    totalAssigned,
    updatedAt: now,
    ...(allFilled ? { status: 'ready' as FinalExamJobStatus, readyAt: now } : {}),
  };
  await db.collection(FINAL_EXAM_JOBS_COLLECTION).updateOne({ _id: job._id }, { $set: update });
  return { ...job, ...update } as FinalExamJobDoc;
}
