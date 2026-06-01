/**
 * passage_analyses 의 svocData 에 「char-based」 와 「word-based」 두 가지 인덱싱 컨벤션이
 * 섞여 있는 현상을 흡수하기 위한 정규화 헬퍼.
 *
 * - 최신 분석기 (lib/syntax-analyzer-word-match.ts 의 findWordIndices) 는 word index 기준이지만,
 *   일부 과거 데이터는 char offset 으로 저장되어 있다.
 * - 휴리스틱: 한 문장의 svocData 안에서 가장 큰 end 값이 (단어 수 - 1) 을 초과하면 char-based 로 판정.
 *   (단어 수가 5개인데 end 가 17 이면 명백히 char-based.)
 * - char-based 면 sentence 토큰화로 char 범위 → word 범위 매핑.
 *
 * 결과: 클라이언트는 항상 「word index」 컨벤션만 받음 → 표시 로직은 단순.
 */

import type { SvocSentenceData } from '@/lib/passage-analyzer-types';

interface WordSpan {
  /** sentence 내 char offset (inclusive) */
  start: number;
  /** sentence 내 char offset (inclusive) */
  end: number;
  word: string;
}

/**
 * sentence 를 `split(/\s+/)` 컨벤션대로 토큰화하면서 각 토큰의 원문 char 범위를 추적.
 *
 * findWordIndices 와 동일한 split 규칙 → 결과 wordIndex 는 분석기 호환.
 */
function buildWordSpans(sentence: string): WordSpan[] {
  const tokens = sentence.split(/\s+/);
  const spans: WordSpan[] = [];
  let cursor = 0;
  for (const word of tokens) {
    if (!word) {
      // 빈 토큰(선두/말미/중복 공백) — wordIndex 자체는 분석기와 맞춰야 하므로 자리 유지.
      spans.push({ start: cursor, end: cursor, word: '' });
      continue;
    }
    const idx = sentence.indexOf(word, cursor);
    if (idx === -1) {
      // 비정상 (있을 수 없는 경우) — 안전 fallback
      spans.push({ start: cursor, end: cursor + word.length - 1, word });
      cursor += word.length;
    } else {
      spans.push({ start: idx, end: idx + word.length - 1, word });
      cursor = idx + word.length;
    }
  }
  return spans;
}

/**
 * [charStart, charEnd] 가 겹치는 모든 word 의 인덱스 범위 반환.
 *
 * "겹친다" = word.start <= charEnd && word.end >= charStart
 * (한 단어라도 영역 안에 들어오면 카운트)
 */
function charRangeToWordRange(
  charStart: number,
  charEnd: number,
  spans: WordSpan[],
): { wordStart: number; wordEnd: number } {
  let wordStart = -1;
  let wordEnd = -1;
  for (let i = 0; i < spans.length; i++) {
    const w = spans[i];
    if (!w.word) continue; // 빈 토큰은 매칭 대상 제외
    if (w.start <= charEnd && w.end >= charStart) {
      if (wordStart === -1) wordStart = i;
      wordEnd = i;
    }
  }
  return { wordStart, wordEnd };
}

/** SvocSentenceData 안의 모든 (start, end) 키 쌍 — 누락 없이 전부 변환 */
const RANGE_PAIRS: Array<[keyof SvocSentenceData, keyof SvocSentenceData]> = [
  ['subjectStart', 'subjectEnd'],
  ['verbStart', 'verbEnd'],
  ['objectStart', 'objectEnd'],
  ['complementStart', 'complementEnd'],
  ['indirectObjectStart', 'indirectObjectEnd'],
  ['directObjectStart', 'directObjectEnd'],
  ['subjectComplementStart', 'subjectComplementEnd'],
  ['objectComplementStart', 'objectComplementEnd'],
];

function getNumOrNull(obj: SvocSentenceData, key: keyof SvocSentenceData): number | null {
  const v = obj[key];
  return typeof v === 'number' && v >= 0 ? v : null;
}

/**
 * 한 sentence 의 svocData 가 char-based 인지 판정.
 * 가장 큰 end 값이 (단어수 - 1) 을 초과하면 char-based 로 간주.
 */
function isCharBasedSvoc(sv: SvocSentenceData, wordCount: number): boolean {
  const maxWordIdx = Math.max(0, wordCount - 1);
  let maxEnd = -1;
  for (const [, endKey] of RANGE_PAIRS) {
    const v = getNumOrNull(sv, endKey);
    if (v != null && v > maxEnd) maxEnd = v;
  }
  return maxEnd > maxWordIdx;
}

/**
 * 한 sentence 의 svocData 를 word-based 로 변환.
 * 이미 word-based 면 그대로 반환.
 */
export function normalizeSvocSentenceToWordIndices(
  sv: SvocSentenceData,
  sentence: string,
): SvocSentenceData {
  const spans = buildWordSpans(sentence);
  if (!isCharBasedSvoc(sv, spans.length)) return sv;

  const next: SvocSentenceData = { ...sv };
  for (const [startKey, endKey] of RANGE_PAIRS) {
    const s = getNumOrNull(sv, startKey);
    const e = getNumOrNull(sv, endKey);
    if (s == null || e == null) continue;
    const { wordStart, wordEnd } = charRangeToWordRange(s, e, spans);
    // SvocSentenceData 의 키들은 number 또는 nullable number — 캐스트로 안전하게 대입
    (next as unknown as Record<string, number | null>)[startKey as string] = wordStart;
    (next as unknown as Record<string, number | null>)[endKey as string] = wordEnd;
  }
  return next;
}

/** 입력 value 가 단일 객체이든 배열이든 항상 SvocSentenceData[] 로 정규화 */
function toClauseArray(v: SvocSentenceData | SvocSentenceData[] | undefined): SvocSentenceData[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * passage 전체 svocData 정규화 — 문장별 + 절별 독립 적용.
 *
 * 입력 형태: 단일 SvocSentenceData 또는 SvocSentenceData[] (호환).
 * 출력 형태: 항상 SvocSentenceData[] — 클라이언트는 일관된 array shape.
 *
 * sentences: 분석기 / GET API 가 derive 한 영문 문장 배열.
 * svocData: passageStates.main.svocData.
 */
export function normalizeSvocDataToWordIndices(
  sentences: string[],
  svocData: Record<number, SvocSentenceData | SvocSentenceData[]> | undefined,
): Record<number, SvocSentenceData[]> | undefined {
  if (!svocData) return undefined;
  const out: Record<number, SvocSentenceData[]> = {};
  for (const [keyStr, raw] of Object.entries(svocData)) {
    const sentIdx = Number(keyStr);
    if (!Number.isInteger(sentIdx)) continue;
    const sentence = sentences[sentIdx] || '';
    const clauses = toClauseArray(raw);
    out[sentIdx] = clauses.map((c) => normalizeSvocSentenceToWordIndices(c, sentence));
  }
  return out;
}

/**
 * svocData[i] 가 sentences[i] 와 정렬되는지 검증 — 절별로 독립 검사.
 *
 * 일부 과거 데이터는 분석기가 「Paul ... real.」 같은 한 줄 안의 두 문장을 별도로 split 해서
 * 인덱스가 어긋난다. 다절 데이터에서는 절 단위로 잘못 정렬된 것만 drop.
 *
 * 검증: 각 절의 subject 가 sentence 안에 substring 으로 나타나는지 (대소문자 무시).
 * 모든 절이 fail 한 sentence 는 entry 자체 제외. 일부만 fail 하면 살아남은 절만 유지.
 */
export function alignSvocDataToSentences(
  sentences: string[],
  svocData: Record<number, SvocSentenceData[]> | undefined,
): Record<number, SvocSentenceData[]> | undefined {
  if (!svocData) return undefined;
  const out: Record<number, SvocSentenceData[]> = {};
  for (const [keyStr, clauses] of Object.entries(svocData)) {
    const sentIdx = Number(keyStr);
    if (!Number.isInteger(sentIdx)) continue;
    const sentence = sentences[sentIdx];
    if (!sentence) continue;
    const kept = clauses.filter((sv) => {
      const subject = (sv.subject || '').trim();
      // subject 가 비어있으면 검증 불가 — 일단 통과 (보수적)
      if (!subject) return true;
      return sentence.toLowerCase().includes(subject.toLowerCase());
    });
    if (kept.length > 0) out[sentIdx] = kept;
  }
  return out;
}

