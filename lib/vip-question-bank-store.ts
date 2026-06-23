import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 선생님 개인 문제은행 (즐겨찾기·참조 방식).
 * generated_questions 를 직접 복사하지 않고 questionId 참조 + 표시용 필드 스냅샷만 저장.
 * 실제 출력(시험지 다운로드)은 questionId 로 generated_questions 에서 원본을 읽음.
 */
export const QUESTION_BANK_COLLECTION = 'vip_saved_questions';

export interface SavedQuestionDoc {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  questionId: ObjectId; // generated_questions._id
  serialNo?: number;
  type: string;
  textbook: string;
  source: string;
  difficulty: string;
  question: string; // 발문 미리보기
  preview: string; // 지문 앞부분
  folder: string; // '' = 미분류
  tags: string[];
  savedAt: Date;
}

/** 변형문제 객관식 유형 (불러오기 필터용). */
export const VARIANT_TYPES = [
  '빈칸', '순서', '삽입', '삽입-고난도', '어법', '어법-고난도', '빈칸-고난도', '어휘', '어휘-고난도',
  '함의', '주제', '주장', '제목', '요약', '요지', '일치', '불일치', '무관한문장',
  '순서-고난도', '요약-고난도', '무관한문장-고난도', '함의-고난도',
  '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
];

export const VARIANT_DIFFICULTIES = ['하', '중', '상'];

let _indexed = false;
export async function ensureQuestionBankIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(QUESTION_BANK_COLLECTION).createIndex({ userId: 1, questionId: 1 }, { unique: true }),
    db.collection(QUESTION_BANK_COLLECTION).createIndex({ userId: 1, savedAt: -1 }),
    db.collection(QUESTION_BANK_COLLECTION).createIndex({ userId: 1, folder: 1 }),
    db.collection(QUESTION_BANK_COLLECTION).createIndex({ userId: 1, type: 1 }),
  ]);
}

/** 발문/지문 미리보기 텍스트 추출 (HTML·마크업 제거 후 잘라냄). */
export function previewText(raw: unknown, max = 90): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
