import { ObjectId, type Db } from 'mongodb';
import { generateGradeToken, normalizeCircledAnswer, normalizePhone } from './vip-grade-store';

/* ──────────────────────────────────────────────────────────
 * VIP 수학 QR 자가채점 — 진도 문제지 1장(토큰) 단위로 저장하고,
 * 학생이 전화번호로 본인 확인 후 답안을 제출해 자동 채점.
 *  · 객관식: ①~⑤ OMR 자동채점 (normalizeCircledAnswer).
 *  · 주관식: 정답 문자열 정규화(normalizeMathAnswer) 매칭 자동채점,
 *           불일치 시 정답을 공개하고 학생이 O/X 자가채점(selfMarked).
 * 재응시는 공식(첫 제출) 점수 불변 — vip-grade-store 패턴과 동일.
 * 토큰·전화 정규화·재응시 규칙은 exam-grade 와 공용.
 * ────────────────────────────────────────────────────────── */

export const MATH_GRADE_PAPERS_COLLECTION = 'vip_math_grade_papers';
export const MATH_GRADE_RESULTS_COLLECTION = 'vip_math_gradings';

export { generateGradeToken, normalizeCircledAnswer, normalizePhone };

/** 채점지에 담긴 1문항 (채점 기준). */
export interface MathGradePaperQuestion {
  num: number;
  problemId: string;
  serial: string; // M-000123
  topicKey: string;
  학습주제: string;
  difficulty: string; // 기본 | 중 | 고
  type: string; // 객관식 | 주관식
  question: string;
  choices?: string[]; // 객관식 선택지
  correctAnswer: string; // 객관식=①~⑤ · 주관식=정답 문자열
  acceptedAnswers?: string[]; // 주관식 허용 별해(선택)
  score: number;
}

export interface MathGradePaperDoc {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  token: string;
  title: string;
  교과: string;
  topicKey: string;
  학습주제: string;
  questions: MathGradePaperQuestion[];
  objectiveCount: number; // 객관식 수
  subjectiveCount: number; // 주관식 수
  maxScore: number; // 전체 배점 합 (만점)
  createdAt: Date;
}

export interface MathGradeAnswer {
  num: number;
  type: string; // 객관식 | 주관식
  topicKey: string;
  학습주제: string;
  difficulty: string;
  chosen: string; // 학생 입력 (객관식=①.. · 주관식=원문)
  correct: string; // 정답 (결과 화면 공개)
  isCorrect: boolean; // 자동채점 결과
  needsSelfCheck: boolean; // 주관식 자동 불일치 → 학생 O/X 필요
  selfMarked?: boolean; // 학생이 "내 답 맞음"으로 표시(자가채점 보정)
  score: number; // 이 문항 배점
}

/** 재응시(공식 점수 불변, 최신 재응시만 보관). */
export interface MathGradeRetake {
  attemptCount: number;
  correctCount: number;
  totalCount: number;
  earnedScore: number;
  maxScore: number;
  wrongNums: number[];
  createdAt: Date;
}

export interface MathGradeResultDoc {
  _id?: ObjectId;
  paperId: ObjectId;
  userId: ObjectId; // 선생님
  token: string;
  studentId?: ObjectId | null;
  studentName: string;
  studentPhone: string;
  answers: MathGradeAnswer[];
  correctCount: number; // 자동채점 정답 수
  totalCount: number; // 전체 문항 수
  earnedScore: number; // 자동채점 획득 점수
  maxScore: number;
  selfCorrectCount: number; // 자가채점(selfMarked) 반영 정답 수
  selfEarnedScore: number; // 자가채점 반영 점수
  byTopic: { 학습주제: string; correct: number; total: number }[];
  byDifficulty: { difficulty: string; correct: number; total: number }[];
  retake?: MathGradeRetake;
  createdAt: Date;
}

/**
 * 수학 주관식 정답 정규화 — 공백 제거, 마이너스/유니코드 통일, 소문자화 등.
 * 완벽 매칭은 불가 → 자동 불일치 시 자가채점(O/X)으로 보정.
 */
export function normalizeMathAnswer(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.toLowerCase();
  // 마이너스/대시 통일, 곱셈기호·가운뎃점 통일, 물결/유사문자 정리
  s = s.replace(/[−–—－]/g, '-').replace(/[×⋅·*]/g, '*');
  // 분수 슬래시 주변 공백 제거, 등호 앞 변수 라벨(x=, y= 등) 제거
  s = s.replace(/^[a-z]\s*=\s*/, '');
  // 콤마/괄호/공백 정리
  s = s.replace(/\s+/g, '');
  // 후행 마침표 제거
  s = s.replace(/\.$/, '');
  return s;
}

/** 주관식 정답 일치 여부 (정답 + 허용 별해). */
export function matchesSubjective(chosen: string, correct: string, accepted?: string[]): boolean {
  const c = normalizeMathAnswer(chosen);
  if (!c) return false;
  if (c === normalizeMathAnswer(correct)) return true;
  return (accepted ?? []).some((a) => c === normalizeMathAnswer(a));
}

export async function getMathGradePaperByToken(db: Db, token: string): Promise<MathGradePaperDoc | null> {
  const t = String(token ?? '').trim();
  if (!/^[a-f0-9]{16,64}$/i.test(t)) return null;
  return db.collection<MathGradePaperDoc>(MATH_GRADE_PAPERS_COLLECTION).findOne({ token: t });
}

let _mathGradeIndexed = false;
/** 결과 유니크 인덱스 (paperId, studentId) — 재제출 중복 방지. */
export async function ensureMathGradeIndexes(db: Db): Promise<void> {
  if (_mathGradeIndexed) return;
  _mathGradeIndexed = true;
  try {
    await db.collection(MATH_GRADE_RESULTS_COLLECTION).createIndex({ paperId: 1, studentId: 1 }, { unique: true });
  } catch { /* 인덱스 없이도 $setOnInsert 로 대부분 방지 */ }
}

/** 채점지 + 제출답안(num→입력) → 자동 채점 결과(자가채점 전). */
export function gradeMathPaper(
  paper: MathGradePaperDoc,
  chosenByNum: Map<number, string>,
): Pick<MathGradeResultDoc, 'answers' | 'correctCount' | 'totalCount' | 'earnedScore' | 'maxScore' | 'selfCorrectCount' | 'selfEarnedScore' | 'byTopic' | 'byDifficulty'> {
  const answers: MathGradeAnswer[] = [];
  const byTopic = new Map<string, { correct: number; total: number }>();
  const byDiff = new Map<string, { correct: number; total: number }>();
  let correctCount = 0;
  let earnedScore = 0;

  for (const q of paper.questions) {
    const rawChosen = chosenByNum.get(q.num) ?? '';
    let chosen: string;
    let isCorrect: boolean;
    let needsSelfCheck = false;
    if (q.type === '객관식') {
      chosen = normalizeCircledAnswer(rawChosen);
      isCorrect = chosen.length > 0 && chosen === normalizeCircledAnswer(q.correctAnswer);
    } else {
      chosen = String(rawChosen ?? '').trim();
      isCorrect = matchesSubjective(chosen, q.correctAnswer, q.acceptedAnswers);
      needsSelfCheck = !isCorrect && chosen.length > 0; // 답을 냈는데 자동 불일치 → 자가채점 유도
    }
    const score = Number(q.score) || 0;
    if (isCorrect) { correctCount += 1; earnedScore += score; }
    answers.push({
      num: q.num, type: q.type, topicKey: q.topicKey, 학습주제: q.학습주제, difficulty: q.difficulty,
      chosen, correct: q.correctAnswer, isCorrect, needsSelfCheck, score,
    });
    const t = byTopic.get(q.학습주제) ?? { correct: 0, total: 0 };
    t.total += 1; if (isCorrect) t.correct += 1; byTopic.set(q.학습주제, t);
    const d = byDiff.get(q.difficulty) ?? { correct: 0, total: 0 };
    d.total += 1; if (isCorrect) d.correct += 1; byDiff.set(q.difficulty, d);
  }

  return {
    answers,
    correctCount,
    totalCount: paper.questions.length,
    earnedScore,
    maxScore: paper.maxScore,
    selfCorrectCount: correctCount, // 자가채점 전엔 자동과 동일
    selfEarnedScore: earnedScore,
    byTopic: [...byTopic.entries()].map(([학습주제, v]) => ({ 학습주제, ...v })),
    byDifficulty: [...byDiff.entries()].map(([difficulty, v]) => ({ difficulty, ...v })),
  };
}

/** 자가채점(selfMarked) 반영 점수 재계산 — 자동 오답을 학생이 정답 처리한 만큼 가산. */
export function computeSelfScore(answers: MathGradeAnswer[]): { selfCorrectCount: number; selfEarnedScore: number } {
  let selfCorrectCount = 0;
  let selfEarnedScore = 0;
  for (const a of answers) {
    const ok = a.isCorrect || a.selfMarked === true;
    if (ok) { selfCorrectCount += 1; selfEarnedScore += Number(a.score) || 0; }
  }
  return { selfCorrectCount, selfEarnedScore };
}
