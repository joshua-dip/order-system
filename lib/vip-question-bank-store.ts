import { ObjectId, type Db } from 'mongodb';
import { buildVariantQFilter } from './admin-generated-questions-q-filter';

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

/**
 * 불러오기(browse) 검색 필터 — 검색(search route)과 「검색결과 전체 담기」(POST all)에서 동일하게 사용.
 * type/textbook/difficulty 정확일치 + q(고유번호 V-… / 출처·교재 라벨) 검색.
 */
export function buildBrowseFilter(params: { type?: string; textbook?: string; difficulty?: string; q?: string }): Record<string, unknown> {
  const filter: Record<string, unknown> = { status: '완료' };
  const type = (params.type || '').trim();
  const textbook = (params.textbook || '').trim();
  const difficulty = (params.difficulty || '').trim();
  const q = (params.q || '').trim();
  if (type) filter.type = type;
  if (textbook) filter.textbook = textbook;
  if (difficulty) filter.difficulty = difficulty;
  if (q) {
    const serialMatch = q.match(/^v?-?\s*0*(\d{1,7})$/i);
    if (serialMatch) {
      filter.serialNo = Number(serialMatch[1]);
    } else {
      const qf = buildVariantQFilter(q);
      if (qf) Object.assign(filter, qf);
      else filter.source = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
  }
  return filter;
}

/** 「검색결과 전체 담기」 1회 최대 담기 수 (대량 쓰기 방지). */
export const BROWSE_BULK_MAX = 2000;

/** 발문/지문 미리보기 텍스트 추출 (HTML·마크업·`###` 구분자 제거 후 잘라냄). */
export function previewText(raw: unknown, max = 90): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s*###\s*/g, ' ') // 보기/블록 구분자 `###` 는 미리보기에 노출하지 않음
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
