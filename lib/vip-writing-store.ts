import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 영작 수업 — 선생님이 영작 주제를 출제하고, 학생 영작을 받아 수동 첨삭(교정·피드백·점수)하는 도구.
 * AI 자동첨삭이 아니라 선생님이 직접 첨삭하는 수동 워크플로우 (API 무과금 정책 부합).
 *  · vip_writing_topics      : 영작 주제(지시문·권장 단어수·참고 모범답안)
 *  · vip_writing_submissions : 학생별 제출 영작 + 첨삭본·피드백·점수
 */
export const VIP_WRITING_TOPICS_COLLECTION = 'vip_writing_topics';
export const VIP_WRITING_SUBMISSIONS_COLLECTION = 'vip_writing_submissions';

export const WRITING_LEVELS = ['기초', '중급', '심화'] as const;
export type WritingLevel = (typeof WRITING_LEVELS)[number];
export function isWritingLevel(v: unknown): v is WritingLevel {
  return typeof v === 'string' && (WRITING_LEVELS as readonly string[]).includes(v);
}

export const SUBMISSION_STATUSES = ['제출', '첨삭완료'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface VipWritingTopic {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  prompt: string; // 주제 지시문/설명
  targetWords?: number; // 권장 단어 수
  level: WritingLevel;
  reference?: string; // 모범답안/체크리스트(선생님 참고)
  createdAt: Date;
  updatedAt?: Date;
}

export interface VipWritingSubmission {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  topicId?: ObjectId; // 주제(선택) — 자유 주제면 없음
  topicTitle: string; // 표시용 스냅샷
  studentId: ObjectId;
  studentName: string;
  date: string; // 'YYYY-MM-DD'
  original: string; // 학생 영작 원문
  corrected?: string; // 첨삭본(교정된 글)
  feedback?: string; // 총평/피드백
  score?: number; // 0~100
  status: SubmissionStatus;
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureWritingIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_WRITING_TOPICS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }),
    db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).createIndex({ userId: 1, date: -1, createdAt: -1 }),
    db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).createIndex({ userId: 1, topicId: 1 }),
    db.collection(VIP_WRITING_SUBMISSIONS_COLLECTION).createIndex({ userId: 1, studentId: 1 }),
  ]);
}

/** 영어 단어 수 세기 (첨삭 진척·권장 단어수 비교용). */
export function countWords(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}
