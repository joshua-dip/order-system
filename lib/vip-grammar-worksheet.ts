import type { Db, ObjectId } from 'mongodb';

/**
 * VIP 문법 학습지 저장·배정·QR 자가채점 저장소.
 * - vip_grammar_worksheets: 선생님이 만든 학습지 1건(범위·설정 + 문항 스냅샷 + 배정 대상 + QR 토큰).
 * - vip_grammar_gradings: 학생 QR 제출 채점 기록.
 * 문항은 저장 시점 스냅샷(정답키 고정) — 이후 문제은행이 바뀌어도 채점 안정.
 */
export const GRAMMAR_WORKSHEETS_COLLECTION = 'vip_grammar_worksheets';
export const GRAMMAR_GRADINGS_COLLECTION = 'vip_grammar_gradings';

/** 인쇄 순서대로 번호(num) 매긴 문항 스냅샷. 객관식(options 있음)만 QR 채점 대상. */
export interface WorksheetItem {
  num: number;
  serial: string;
  topicKey: string;
  category: string;
  question: string;
  options?: string[];
  answer: string;       // 객관식: ①~④ / 그 외: 단어·문장
  explanation?: string;
}

export interface WorksheetTarget {
  studentId: ObjectId;
  studentName: string;
  status: 'assigned' | 'submitted' | 'done';
  updatedAt: Date;
}

export interface GrammarWorksheet {
  _id?: ObjectId;
  userId: ObjectId;
  title: string;
  topicKeys: string[];
  category: string;      // 저장 당시 카테고리 필터('' = 전체)
  source: string;
  fmt: 'mc' | 'subjective';
  includeConcepts: boolean;
  withAnswers: boolean;
  gradeToken: string;    // QR 자가채점 진입 토큰
  items: WorksheetItem[];
  gradableCount: number; // 객관식(채점 가능) 수
  targets: WorksheetTarget[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GrammarGrading {
  _id?: ObjectId;
  worksheetId: ObjectId;
  ownerUserId: ObjectId;
  studentName: string;
  answers: { num: number; chosen: string; correct: string; isCorrect: boolean }[];
  score: number;
  total: number;
  createdAt: Date;
}

export async function ensureWorksheetIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(GRAMMAR_WORKSHEETS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }).catch(() => {}),
    db.collection(GRAMMAR_WORKSHEETS_COLLECTION).createIndex({ gradeToken: 1 }, { unique: true }).catch(() => {}),
    db.collection(GRAMMAR_GRADINGS_COLLECTION).createIndex({ worksheetId: 1, createdAt: -1 }).catch(() => {}),
  ]);
}
