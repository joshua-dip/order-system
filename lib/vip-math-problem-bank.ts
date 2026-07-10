import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

/**
 * VIP 수학 문제은행 (vip_math_problems).
 * - 수학 문제관리 진도 트리의 topicKey 로 문제를 매칭 (mathTopicKey — lib/math-curriculum.ts)
 * - 소유자(userId) 단위 스코프 — 계정 간 공유 없음.
 * - 고유번호: counters 원자 $inc → 정수 serialNo, 표시 M-000123 (generated-question-serial 패턴).
 * - Pro 전용: 채팅에서 문항을 작성하고 cc:math CLI 로 저장 (Anthropic API 호출 없음).
 */

export const MATH_PROBLEMS_COLLECTION = 'vip_math_problems';
export const MATH_SERIAL_COUNTER_ID = 'vip_math_problems_serial';

/** 난도 (표시·필터·정렬용). */
export const MATH_DIFFICULTIES = ['기본', '중', '고'] as const;
export type MathDifficulty = (typeof MATH_DIFFICULTIES)[number];

/** 문항 형식. */
export const MATH_PROBLEM_TYPES = ['주관식', '객관식'] as const;
export type MathProblemType = (typeof MATH_PROBLEM_TYPES)[number];

export interface MathProblemDoc {
  _id?: ObjectId;
  userId: ObjectId;
  serialNo: number;
  topicKey: string; // 교과 > 대단원 > 중단원 > 소단원 > (그룹명 >) 주제 (mathTopicKey)
  교과: string;
  대단원: string;
  중단원: string;
  소단원: string;
  그룹명?: string; // 중등만 (고등은 없음)
  학습주제: string;
  no: number; // 진도 내 표시 순번 (정렬용)
  difficulty: MathDifficulty; // 기본 | 중 | 고
  type: MathProblemType; // 주관식 | 객관식
  question: string; // 문제 본문 (여러 줄 허용)
  choices?: string[]; // 객관식 선택지 (①~⑤ 순서, 원 번호 제외 텍스트)
  answer: string; // 주관식=값/식 · 객관식=①~⑤
  solution: string; // 풀이/해설
  source: string; // 출처 라벨 (예: 자체 제작)
  createdAt: Date;
  updatedAt: Date;
}

/** 난도 정렬 우선순위 (기본 → 중 → 고). */
export function difficultyRank(d: unknown): number {
  const i = (MATH_DIFFICULTIES as readonly string[]).indexOf(String(d));
  return i < 0 ? 99 : i;
}

/** 다음 고유 일련번호를 원자적으로 발급. */
export async function nextMathSerial(db: Db): Promise<number> {
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: MATH_SERIAL_COUNTER_ID as unknown as ObjectId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = (result as unknown as { seq?: number })?.seq;
  return typeof seq === 'number' && seq > 0 ? seq : 1;
}

/** 표시용 포맷: M-000123. */
export function formatMathSerial(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `M-${String(Math.floor(v)).padStart(6, '0')}`;
}
