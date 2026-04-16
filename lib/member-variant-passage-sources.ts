import mockExamsModule from '@/app/data/mock-exams.json';
import { mockExamOrderKeyToPassageTextbookCandidates } from '@/lib/mock-variant-order';
import { isEbsTextbook } from '@/lib/textbookSort';

const mockExamsRaw =
  typeof mockExamsModule === 'object' &&
  mockExamsModule !== null &&
  'default' in mockExamsModule &&
  typeof (mockExamsModule as { default?: unknown }).default === 'object'
    ? (mockExamsModule as { default: Record<string, unknown> }).default
    : (mockExamsModule as Record<string, unknown>);

/** mock-exams.json 에 나열된 모의고사 교재 키(고1_/고2_/고3_ …) */
const MOCK_EXAM_TEXTBOOK_KEYS = new Set<string>();
for (const v of Object.values(mockExamsRaw)) {
  if (!Array.isArray(v)) continue;
  for (const k of v) {
    if (typeof k === 'string' && k.trim()) MOCK_EXAM_TEXTBOOK_KEYS.add(k.trim());
  }
}

/** 변형문제 만들기「소스 불러오기」에서 허용하는 passages.textbook (EBS 고정 목록 + 공식 모의고사 키만) */
export function isAllowedMemberVariantPassageTextbook(textbook: string): boolean {
  const t = textbook.trim();
  if (!t) return false;
  if (isEbsTextbook(t)) return true;
  return MOCK_EXAM_TEXTBOOK_KEYS.has(t);
}

/**
 * UI에서 고른 값이 주문용 모의고사 키(예: 고1_2026_03월(서울시))일 때,
 * MongoDB passages.textbook 과 매칭 (원문은 보통 26년 3월 고1 영어모의고사 등 별도 표기).
 */
export function passageMongoTextbookMatch(textbookParam: string): Record<string, unknown> {
  const t = textbookParam.trim();
  if (isEbsTextbook(t)) return { textbook: t };
  if (MOCK_EXAM_TEXTBOOK_KEYS.has(t)) {
    const list = mockExamOrderKeyToPassageTextbookCandidates(t);
    return { textbook: { $in: list.length ? list : [t] } };
  }
  return { textbook: t };
}

/** passages 문서에 실제로 들어 있는 textbook 값이 회원 소스 불러오기 범위인지 */
export function isPassageDocTextbookAllowedForMemberVariant(storedTextbook: string): boolean {
  const t = storedTextbook.trim();
  if (!t) return false;
  if (isEbsTextbook(t)) return true;
  if (MOCK_EXAM_TEXTBOOK_KEYS.has(t)) return true;
  for (const orderKey of MOCK_EXAM_TEXTBOOK_KEYS) {
    if (mockExamOrderKeyToPassageTextbookCandidates(orderKey).includes(t)) return true;
  }
  return false;
}

/**
 * passages.textbook 기준 **공식 모의고사**만 (EBS 부교재 등 제외).
 * 마이페이지 단어장 교재 목록 등에 사용.
 */
export function isMockExamPassageTextbookStored(storedTextbook: string): boolean {
  const t = storedTextbook.trim();
  if (!t || isEbsTextbook(t)) return false;
  if (MOCK_EXAM_TEXTBOOK_KEYS.has(t)) return true;
  for (const orderKey of MOCK_EXAM_TEXTBOOK_KEYS) {
    if (mockExamOrderKeyToPassageTextbookCandidates(orderKey).includes(t)) return true;
  }
  return false;
}

export { MOCK_EXAM_TEXTBOOK_KEYS };
