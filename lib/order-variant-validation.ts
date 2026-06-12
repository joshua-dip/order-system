/**
 * 순서(글의순서) 변형문제 검증 공용 로직.
 * /api/admin/generated-questions/validate/order-options · order-answer-verify 에서 사용.
 *
 * 보기 분리는 splitQuestionOptionSegments(### 신규 규칙, 줄바꿈은 기존 DB 호환) 기준.
 * 정답 대조는 보기 배열이 고정 5세트가 아니어도 문항 자신의 Options 안에서
 * 읽기 순서 순열을 찾아 동그라미 번호를 정한다.
 */
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';

export const ORDER_CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

/** 표준 고정 5세트 (①~⑤ 순서 고정) */
export const ORDER_FIXED_OPTIONS = [
  '(A)-(C)-(B)',
  '(B)-(A)-(C)',
  '(B)-(C)-(A)',
  '(C)-(A)-(B)',
  '(C)-(B)-(A)',
] as const;

/** 선택지 하나를 순열 문자열로 정규화 — 앞 번호 제거 + " - " 압축 */
export function normalizeOrderOption(s: string): string {
  return s
    .trim()
    .replace(/^[①②③④⑤\d][.)．\s]*/, '')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

/** Options(string | string[]) → 개별 선택지 배열 */
export function parseOrderOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return splitQuestionOptionSegments(raw);
  }
  return [];
}

/** 보기 5개가 표준 고정 세트와 순서까지 일치하는지 */
export function isStandardOrderOptions(raw: unknown): boolean {
  const parts = parseOrderOptions(raw);
  if (parts.length !== ORDER_FIXED_OPTIONS.length) return false;
  const normalized = parts.map(normalizeOrderOption);
  return normalized.every((v, i) => v === ORDER_FIXED_OPTIONS[i]);
}

/**
 * 읽기 순서 순열(예: "(B)-(A)-(C)")이 문항 자신의 Options 에서 몇 번 보기인지 찾아
 * 동그라미 번호로 돌려준다. 보기에 없으면(비표준 세트에서 해당 순열 누락) null —
 * 이 경우 정답을 보기로 표현할 수 없으므로 자동수정 대상에서 제외해야 한다.
 */
export function correctAnswerFromOwnOptions(
  raw: unknown,
  readingPerm: string,
): string | null {
  const normalized = parseOrderOptions(raw).map(normalizeOrderOption);
  const idx = normalized.indexOf(readingPerm);
  return idx >= 0 && idx < ORDER_CIRCLED.length ? ORDER_CIRCLED[idx] : null;
}

/** 'BAC' → "(B)-(A)-(C)" */
export function readingKeyToPerm(key: string): string {
  return key
    .split('')
    .map((c) => `(${c})`)
    .join('-');
}

export interface OrderParagraphParts {
  intro: string;
  A: string;
  B: string;
  C: string;
}

/** Paragraph 를 도입부 + (A)(B)(C) 청크로 분해 (### 구분 우선, 빈 줄 호환) */
export function parseOrderParagraph(raw: string): OrderParagraphParts | null {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1);
  if (m1) return { intro: m1[1].trim(), A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim() };

  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2);
  if (m2) return { intro: m2[1].trim(), A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim() };

  return null;
}

function normalizeForSearch(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 원문에서 segment 시작 위치 탐색 — 긴 prefix 부터 점점 줄여 시도, 실패 시 -1 */
export function findPositionInOriginal(original: string, segment: string): number {
  const normOrig = normalizeForSearch(original);
  for (const len of [80, 50, 30, 20]) {
    const needle = normalizeForSearch(segment).slice(0, len);
    if (needle.length < 10) continue;
    const idx = normOrig.indexOf(needle);
    if (idx >= 0) return idx;
  }
  const words = normalizeForSearch(segment).split(' ').slice(0, 4).join(' ');
  if (words.length >= 8) {
    const idx = normOrig.indexOf(words);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 원문 내 위치 → 읽기 순서 키('BAC' 등). 위치 미발견이 있으면 null */
export function computeReadingOrderKey(positions: {
  A: number;
  B: number;
  C: number;
}): string | null {
  if (positions.A < 0 || positions.B < 0 || positions.C < 0) return null;
  return (['A', 'B', 'C'] as const)
    .map((k) => ({ label: k, pos: positions[k] }))
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.label)
    .join('');
}
