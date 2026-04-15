/**
 * 아잉카(AINCA) 분석지 PDF 텍스트 파서
 *
 * 페이지 구조 (1 페이지 = 1 문항):
 *   [헤더] 연도 · 월 · 시험명
 *   [문항 정보] XX번 유형 한글주제 영어주제 오답률...
 *   [문법 노트] (생략)
 *   [영어 문장 영역] ❶ English... / 한국어 단어 대역 / ❷ ...
 *   [선택지 및 정답] (있는 경우)
 *   [문법 도식 노트]
 *   [자연스러운 한국어 번역 블록] ❶ 한국어... ❷ ...
 *   [변형문제 예상] ← 섹션 끝 마커
 *   [요약문]
 *
 * 특이사항:
 *   - ❶-❿ (U+2776~U+277F) = 문장 번호 (영어/한국어 모두 같은 문자 사용)
 *   - ①-⑤ (U+2460~U+2464) = 선택지 번호 (다른 문자)
 *   - 영어 문장은 여러 줄에 걸쳐 나뉘기도 함 (절 경계에서 분리)
 *   - 한국어 번역 블록 일부 문장에 영어 단어가 혼재 (Plato는, In fact,)
 *   - ★❹ 처럼 ★ 접두사가 붙을 수 있음
 */

import type { SyntaxPhraseStored, SvocSentenceData, VocabularyEntry } from './passage-analyzer-types';

export interface AincaQuestion {
  questionNumber: number;
  sentences: string[];
  koreanSentences: string[];
  vocabularyList: VocabularyEntry[];
  syntaxPhrases?: Record<number, SyntaxPhraseStored[]>;
  svocData?: Record<number, SvocSentenceData>;
}

// ── 문장 번호 마커 ────────────────────────────────────────
// 아잉카는 ❶❷❸❹❺❻❼❽❾❿ (U+2776~U+277F) 를 사용
// 34번 이상의 문장: ⓫⓬⓭⓮⓯⓰⓱⓲⓳⓴ (U+24EB~U+24F4)
const SENTENCE_CIRCLE_CHARS = '❶❷❸❹❺❻❼❽❾❿⓫⓬⓭⓮⓯⓰⓱⓲⓳⓴';
// 순서 추론 문항에서 '(A) ❷', '(B) ❹', '(C) ❻' 패턴 허용
const SENTENCE_CIRCLE_RE = new RegExp(`^[★]*(?:\\([A-E]\\)\\s*)?[${SENTENCE_CIRCLE_CHARS}]`);
const STRIP_CIRCLE_RE = new RegExp(`^[★\\s]*(?:\\([A-E]\\)\\s*)?[${SENTENCE_CIRCLE_CHARS}]\\s*`);

const KOREAN_RE = /[가-힣]/;
const ENGLISH_RE = /[A-Za-z]{2,}/;

/** PDF에서 추출한 텍스트 → 문항 배열 */
export function parseAincaPdf(rawText: string): AincaQuestion[] {
  // pdf-parse getText() 결과는 이미 string
  return parseFromText(rawText);
}

/**
 * getText() 가 { pages: Array<{ text: string }> } 를 반환할 때
 * 페이지 배열로 파싱
 */
export function parseAincaPages(pages: Array<{ text: string }>): AincaQuestion[] {
  const questions: AincaQuestion[] = [];
  for (const page of pages) {
    const q = parsePage(page.text);
    if (q) questions.push(q);
  }
  return questions;
}

function parseFromText(text: string): AincaQuestion[] {
  // 단일 텍스트(페이지 구분 없음)인 경우 문항 번호로 분리
  // 각 페이지 시작은 "YYYY년 [탭] MM월 [탭] 모의고사" 패턴
  const PAGE_HEADER_RE = /\d{4}년\t\d{2}월\t모의고사/g;
  const matches = [...text.matchAll(PAGE_HEADER_RE)];

  if (matches.length === 0) {
    // 단일 블록으로 처리
    const q = parsePage(text);
    return q ? [q] : [];
  }

  const questions: AincaQuestion[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const q = parsePage(text.slice(start, end));
    if (q) questions.push(q);
  }
  return questions;
}

/**
 * 하나의 줄에 여러 문장 마커(❶❷❸...)가 포함된 경우 분리합니다.
 * ex) "❷ Some plants. ❸ You know..." → ["❷ Some plants.", " ❸ You know..."]
 */
function splitMidlineCircles(line: string): string[] {
  const CIRCLE_SET = new Set([...SENTENCE_CIRCLE_CHARS]);
  const result: string[] = [];
  let current = '';
  let hasContent = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (CIRCLE_SET.has(ch) && hasContent && current.trimStart().length > 0) {
      // 이미 내용이 있고 새 마커 등장 → 여기서 분리
      result.push(current.trimEnd());
      current = ch;
      hasContent = false;
    } else {
      current += ch;
      if (ch.trim()) hasContent = true;
    }
  }
  if (current.trim()) result.push(current);
  return result.length > 0 ? result : [line];
}

function parsePage(pageText: string): AincaQuestion | null {
  const lines = pageText
    .split('\n')
    .flatMap((l) => splitMidlineCircles(l.trimEnd()))
    .map((l) => l.trimEnd());

  // ── 문항 번호 찾기 ──────────────────────────────────────
  let questionNumber = -1;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const m = lines[i].match(/(\d{1,2})번/);
    if (m) {
      questionNumber = parseInt(m[1], 10);
      break;
    }
  }
  if (questionNumber < 0) return null;

  // ── 변형문제 예상 (끝 마커) ─────────────────────────────
  const variantIdx = lines.findIndex((l) => l.includes('변형문제'));
  const contentEnd = variantIdx >= 0 ? variantIdx : lines.length;

  // ── 한국어 블록 시작: contentEnd 이전 마지막 ❶ ─────────
  let koreanBlockStart = -1;
  for (let i = contentEnd - 1; i >= 0; i--) {
    if (lines[i].trimStart().startsWith('❶')) {
      koreanBlockStart = i;
      break;
    }
  }

  // ── 영어 문장 블록 시작: 페이지에서 첫 ❶ ────────────────
  let englishBlockStart = -1;
  for (let i = 0; i < (koreanBlockStart >= 0 ? koreanBlockStart : contentEnd); i++) {
    if (SENTENCE_CIRCLE_RE.test(lines[i].trimStart())) {
      englishBlockStart = i;
      break;
    }
  }

  if (englishBlockStart < 0) return null;

  const englishEnd = koreanBlockStart >= 0 ? koreanBlockStart : contentEnd;

  // ── 영어 문장 추출 ───────────────────────────────────────
  const sentences = extractEnglishSentences(lines, englishBlockStart, englishEnd);

  // ── 한국어 번역 추출 ─────────────────────────────────────
  const koreanSentences =
    koreanBlockStart >= 0
      ? extractKoreanSentences(lines, koreanBlockStart, contentEnd)
      : [];

  return {
    questionNumber,
    sentences,
    koreanSentences,
    vocabularyList: [],
  };
}

/**
 * 문장이 완결되었는지 판단:
 * `.!?` 등 문장 종결 부호로 끝나면 완결 (false), 아니면 다음 행이 이어짐 (true).
 */
function isOpenClause(text: string): boolean {
  // 문장 종결 부호: . ! ? 뒤에 인용부호·괄호·】가 올 수도 있음
  return !/[.!?]["'】)]*\s*$/.test(text);
}

/** 영어 문장 영역에서 문장 배열 추출 */
function extractEnglishSentences(lines: string[], start: number, end: number): string[] {
  const sentences: string[] = [];
  let parts: string[] = [];
  // 현재 문장이 아직 끝나지 않아 다음 영어 행이 이어질 수 있는 상태
  let hasOpenClause = false;

  const flush = () => {
    if (parts.length > 0) {
      const sentence = cleanEnglishSentence(parts.join(' '));
      if (sentence) sentences.push(sentence);
      parts = [];
      hasOpenClause = false;
    }
  };

  for (let i = start; i < end; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed) continue;

    if (SENTENCE_CIRCLE_RE.test(trimmed)) {
      // 새 문장 시작
      flush();
      const text = trimmed.replace(STRIP_CIRCLE_RE, '');
      const joined = tabJoin(text);
      if (ENGLISH_RE.test(joined)) {
        parts = [joined];
        hasOpenClause = isOpenClause(joined);
      }
    } else if (parts.length > 0) {
      const joined = tabJoin(trimmed);
      if (ENGLISH_RE.test(joined) && !KOREAN_RE.test(joined)) {
        if (hasOpenClause) {
          // 문장이 아직 열려 있으면 → 같은 문장의 영어 계속
          parts.push(joined);
          hasOpenClause = isOpenClause(joined);
        }
        // hasOpenClause가 false면 선택지·문법 노트 → 무시
      }
      // 한국어 단어 대역 줄은 조용히 무시 (hasOpenClause 유지)
    }
  }
  flush();

  return sentences;
}

/** 한국어 번역 블록에서 문장 배열 추출 */
function extractKoreanSentences(lines: string[], start: number, end: number): string[] {
  const sentences: string[] = [];
  let parts: string[] = [];

  const flush = () => {
    if (parts.length > 0) {
      const sentence = cleanKoreanSentence(parts.join(' '));
      if (sentence) sentences.push(sentence);
      parts = [];
    }
  };

  for (let i = start; i < end; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed) continue;

    // 건너뛸 줄: 구조 레이블, 장식 문자, 문법 노트
    if (shouldSkipKoreanLine(trimmed)) continue;

    if (SENTENCE_CIRCLE_RE.test(trimmed)) {
      flush();
      const text = trimmed.replace(STRIP_CIRCLE_RE, '');
      const joined = tabJoin(text);
      if (joined) parts = [joined];
    } else if (parts.length > 0) {
      // 계속 줄: 한국어 또는 혼재(한국어 포함) 내용만 추가
      const joined = tabJoin(trimmed);
      if (joined && (KOREAN_RE.test(joined) || ENGLISH_RE.test(joined))) {
        parts.push(joined);
      }
    }
  }
  flush();

  return sentences;
}

/** 한국어 블록에서 건너뛸 줄 판단 */
function shouldSkipKoreanLine(line: string): boolean {
  const t = line.replace(/\t/g, ' ').trim();
  // 빈 줄
  if (!t) return true;
  // 구조 레이블: <도입부>, <주제>, <결론> 등
  if (/^<[^>]+>/.test(t)) return true;
  // 아잉카 장식 문자 (단독 특수 문자 행)
  if (/^[`~ê★☆□■]/.test(t) && !KOREAN_RE.test(t)) return true;
  // è/ê 화살표 주석 (한국어 없는 경우만)
  if (/^[èe►▶→➡]/.test(t) && !KOREAN_RE.test(t)) return true;
  // 한국어/영어가 없는 순수 기호·숫자 줄 (짧은 것만)
  if (!KOREAN_RE.test(t) && !ENGLISH_RE.test(t) && t.length < 10) return true;
  return false;
}

/** 탭으로 구분된 단어들을 공백으로 합치기 */
function tabJoin(text: string): string {
  return text.split('\t').join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** 영어 문장 정리: 구문 마커 제거, 공백 정규화 */
function cleanEnglishSentence(text: string): string {
  return text
    .replace(/【/g, '')
    .replace(/】/g, '')
    .replace(/\s*\/\s*/g, ' ') // 절 경계 마커 / 제거
    .replace(/\s+/g, ' ')
    .trim();
}

/** 한국어 문장 정리 */
function cleanKoreanSentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
