import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'crypto';

/* ──────────────────────────────────────────────────────────
 * VIP QR 자가채점 — 시험지 1장(토큰) 단위로 영구 저장하고,
 * 학생이 전화번호로 본인 확인 후 OMR 답안을 제출해 자동 채점.
 * 채점 결과는 유형별·지문별 정답률로 집계되어 선생님이
 * "어떤 유형·어떤 지문을 복습해야 하는지" 분석할 수 있다.
 * 파이널 모의고사 채점(final-exam-store)과 동일한 패턴.
 * ────────────────────────────────────────────────────────── */

export const GRADE_PAPERS_COLLECTION = 'vip_grade_papers';
export const GRADE_RESULTS_COLLECTION = 'vip_exam_gradings';

/** 시험지에 담긴 객관식 1문항 (채점 기준). */
export interface GradePaperQuestion {
  num: number;
  questionId: string;
  type: string;
  sourceKey: string;
  textbook: string;
  category: '교과서' | '부교재' | '모의고사';
  correctAnswer: string; // ①②③④⑤ (복수 가능)
  score: number;
}

/** 서술형 (자동채점 제외 — 표시·배점 집계만). */
export interface GradePaperSubjective {
  num: number;
  type: string;
  sourceKey: string;
  textbook: string;
  category: '교과서' | '부교재' | '모의고사';
  score: number;
}

export interface GradePaperDoc {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  token: string;
  title: string;
  schoolId?: ObjectId | null;
  schoolName?: string;
  grade?: number | null;
  questions: GradePaperQuestion[];
  subjectives: GradePaperSubjective[];
  objectiveCount: number;
  subjectiveCount: number;
  maxObjectiveScore: number; // 객관식 배점 합 (자동채점 만점)
  totalScore: number; // 객관식 + 서술형 배점 합 (시험지 만점)
  createdAt: Date;
}

export interface GradeAnswer {
  num: number;
  type: string;
  sourceKey: string;
  category: string;
  chosen: string;
  correct: string;
  isCorrect: boolean;
  score: number; // 이 문항 배점 (정답 시 획득)
}

export interface GradeResultDoc {
  _id?: ObjectId;
  paperId: ObjectId;
  userId: ObjectId; // 선생님
  token: string;
  studentId?: ObjectId | null;
  studentName: string;
  studentPhone: string;
  answers: GradeAnswer[];
  correctCount: number; // 맞힌 객관식 문항 수
  objectiveCount: number; // 객관식 총 문항 수
  earnedScore: number; // 획득 점수(객관식 배점 기준)
  maxObjectiveScore: number; // 객관식 만점
  byType: { type: string; correct: number; total: number }[];
  bySource: { sourceKey: string; correct: number; total: number }[];
  createdAt: Date;
}

/* ── 토큰·정규화 ── */

export function generateGradeToken(): string {
  return randomBytes(12).toString('hex');
}

/**
 * (paperId, studentId) 당 중복 채점 결과 정리 — 가장 먼저 제출(createdAt 최소)만 남기고 삭제.
 * '첫 제출 확정' 정책. 유니크 인덱스 생성 전·후 자가 치유용.
 */
export async function dedupeGradeResults(db: Db): Promise<number> {
  const groups = await db.collection(GRADE_RESULTS_COLLECTION).aggregate([
    { $match: { paperId: { $exists: true }, studentId: { $exists: true } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: { paperId: '$paperId', studentId: '$studentId' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  const toDelete: ObjectId[] = [];
  for (const g of groups) toDelete.push(...(g.ids as ObjectId[]).slice(1)); // 첫 건 제외 나머지
  if (toDelete.length === 0) return 0;
  const r = await db.collection(GRADE_RESULTS_COLLECTION).deleteMany({ _id: { $in: toDelete } });
  return r.deletedCount ?? 0;
}

let _gradeIndexed = false;
/**
 * 채점 결과 유니크 인덱스 (paperId, studentId) — 동시/재제출 중복 방지.
 * 기존 중복으로 생성 실패하면 dedupe 후 1회 재시도. (런타임 첫 호출에서 자가 치유)
 */
export async function ensureGradeIndexes(db: Db): Promise<void> {
  if (_gradeIndexed) return;
  _gradeIndexed = true;
  const create = () => db.collection(GRADE_RESULTS_COLLECTION).createIndex({ paperId: 1, studentId: 1 }, { unique: true });
  try {
    await create();
  } catch {
    try { await dedupeGradeResults(db); await create(); } catch { /* 인덱스 없이도 $setOnInsert 가 대부분 막아줌 */ }
  }
}

/** 답안 정규화 — 동그라미 번호만 추려 정렬 (복수정답 "①③" 비교용). 1~5 아라비아도 허용. */
export function normalizeCircledAnswer(raw: string): string {
  const s = String(raw ?? '');
  const circled = s.match(/[①②③④⑤]/g) ?? [];
  // 아라비아 숫자만 들어온 경우 동그라미로 환산
  if (circled.length === 0) {
    const ARABIC = ['', '①', '②', '③', '④', '⑤'];
    const nums = (s.match(/[1-5]/g) ?? []).map((n) => ARABIC[Number(n)] ?? '');
    return [...new Set(nums.filter(Boolean))].sort().join('');
  }
  return [...new Set(circled)].sort().join('');
}

/** 전화번호 정규화 — 숫자만. */
export function normalizePhone(raw: string): string {
  return String(raw ?? '').replace(/[^0-9]/g, '');
}

/* ── 조회 ── */

export async function getGradePaperByToken(db: Db, token: string): Promise<GradePaperDoc | null> {
  const t = String(token ?? '').trim();
  if (!/^[a-f0-9]{16,64}$/i.test(t)) return null;
  return db.collection<GradePaperDoc>(GRADE_PAPERS_COLLECTION).findOne({ token: t });
}

/* ── 채점 ── */

/**
 * 시험지 + 제출답안(num→선택) → 자동 채점 결과.
 * byType/bySource 는 정답률 분석(복습 추천)에 사용.
 */
export function gradePaper(
  paper: GradePaperDoc,
  chosenByNum: Map<number, string>,
): Omit<GradeResultDoc, '_id' | 'paperId' | 'userId' | 'token' | 'studentId' | 'studentName' | 'studentPhone' | 'createdAt'> {
  const answers: GradeAnswer[] = [];
  const byType = new Map<string, { correct: number; total: number }>();
  const bySource = new Map<string, { correct: number; total: number }>();
  let correctCount = 0;
  let earnedScore = 0;

  for (const q of paper.questions) {
    const chosen = normalizeCircledAnswer(chosenByNum.get(q.num) ?? '');
    const correct = normalizeCircledAnswer(q.correctAnswer);
    const isCorrect = chosen.length > 0 && chosen === correct;
    if (isCorrect) {
      correctCount += 1;
      earnedScore += Number(q.score) || 0;
    }
    answers.push({
      num: q.num,
      type: q.type,
      sourceKey: q.sourceKey,
      category: q.category,
      chosen,
      correct,
      isCorrect,
      score: Number(q.score) || 0,
    });
    const t = byType.get(q.type) ?? { correct: 0, total: 0 };
    t.total += 1;
    if (isCorrect) t.correct += 1;
    byType.set(q.type, t);
    const s = bySource.get(q.sourceKey) ?? { correct: 0, total: 0 };
    s.total += 1;
    if (isCorrect) s.correct += 1;
    bySource.set(q.sourceKey, s);
  }

  return {
    answers,
    correctCount,
    objectiveCount: paper.questions.length,
    earnedScore,
    maxObjectiveScore: paper.maxObjectiveScore,
    byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
    bySource: [...bySource.entries()].map(([sourceKey, v]) => ({ sourceKey, ...v })),
  };
}
