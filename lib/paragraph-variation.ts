/**
 * 원문 대비 지문(Paragraph) 변형도 — 순서·삽입·빈칸은 제시 형식이 달라,
 * 정답(CorrectAnswer + Options)을 반영한 뒤 원문과 비교한다.
 */

import { optionsLineForChoice } from '@/lib/question-options-segments';

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

/** 정규화 거리 비율 0~1 (0=동일, 1=완전 다름) */
export function variationRatio(original: string, paragraph: string): number {
  const a = original.trim();
  const b = paragraph.trim();
  if (a.length === 0 && b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length, 1);
  const d = levenshtein(a, b);
  return Math.min(1, d / maxLen);
}

/**
 * 대량 집계용: 앞부분만 비교해 Levenshtein 비용을 제한.
 * `maxLen`이 0 이하면 전체 문자열(기존 variationRatio와 동일).
 */
export function variationRatioTruncated(
  original: string,
  paragraph: string,
  maxLen: number
): number {
  if (!maxLen || maxLen <= 0) return variationRatio(original, paragraph);
  const a0 = original.trim();
  const b0 = paragraph.trim();
  const a = a0.length > maxLen ? a0.slice(0, maxLen) : a0;
  const b = b0.length > maxLen ? b0.slice(0, maxLen) : b0;
  return variationRatio(a, b);
}

const CIRCLED_NUM: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
};

function parseChoiceNumber(answer: string): number {
  const t = answer.trim();
  if (!t) return 0;
  if (CIRCLED_NUM[t] != null) return CIRCLED_NUM[t]!;
  const first = t.charAt(0);
  if (CIRCLED_NUM[first] != null) return CIRCLED_NUM[first]!;
  const n = parseInt(t.replace(/[^\d]/g, ''), 10);
  if (n >= 1 && n <= 5) return n;
  return 0;
}

/** (A)(B)(C) 블록 추출 — preamble은 첫 (A/B/C) 앞까지 */
function extractOrderBlocks(para: string): { preamble: string; byLetter: Record<string, string> } | null {
  const text = para.replace(/\r\n/g, '\n');
  const re = /\(([A-Ca-c])\)/g;
  const hits: { index: number; letter: string; afterLabel: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.push({
      index: m.index,
      letter: m[1].toUpperCase(),
      afterLabel: m.index + m[0].length,
    });
  }
  if (hits.length < 3) return null;
  for (const c of ['A', 'B', 'C']) {
    if (!hits.some((h) => h.letter === c)) return null;
  }
  const preamble = text.slice(0, hits[0].index).trim();
  const byLetter: Record<string, string> = {};
  for (let i = 0; i < hits.length; i++) {
    const { letter, afterLabel } = hits[i];
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    byLetter[letter] = text.slice(afterLabel, end).trim();
  }
  return { preamble, byLetter };
}

/** 보기 한 줄에서 (A)-(C)-(B) 등 순서 추출 */
function parseOrderSequenceFromLine(line: string): string[] | null {
  const seq = [...line.matchAll(/\(([A-Ca-c])\)/g)].map((x) => x[1].toUpperCase());
  const need = ['A', 'B', 'C'] as const;
  const picked: string[] = [];
  for (const c of seq) {
    if ((c === 'A' || c === 'B' || c === 'C') && !picked.includes(c)) picked.push(c);
    if (picked.length === 3) break;
  }
  if (picked.length !== 3) return null;
  for (const c of need) {
    if (!picked.includes(c)) return null;
  }
  return picked;
}

function tryReconstructOrderParagraph(
  paragraph: string,
  options: string,
  correctAnswer: string
): string | null {
  const blocks = extractOrderBlocks(paragraph);
  if (!blocks) return null;
  const choice = parseChoiceNumber(correctAnswer);
  if (!choice) return null;
  const line = optionsLineForChoice(options, choice);
  if (!line) return null;
  const order = parseOrderSequenceFromLine(line);
  if (!order) return null;
  const parts = order.map((L) => blocks.byLetter[L]).filter((p) => p.length > 0);
  if (parts.length !== 3) return null;
  const body = parts.join('\n\n').trim();
  if (blocks.preamble) {
    return `${blocks.preamble}\n\n${body}`.trim();
  }
  return body;
}

function splitInsertionParagraph(para: string): { given: string; body: string } | null {
  const text = para.replace(/\r\n/g, '\n');
  const trySplit = (sep: RegExp): { given: string; body: string } | null => {
    const idx = text.search(sep);
    if (idx < 0) return null;
    const given = text.slice(0, idx).trim();
    const rest = text.slice(idx).replace(/^\s*(?:\n+|###\s*)+/, '').trim();
    if (!given || !rest) return null;
    return { given, body: rest };
  };
  return trySplit(/\n\s*\n/) ?? trySplit(/\n###\s*\n/) ?? trySplit(/^###\s*\n/m);
}

function tryReconstructInsertionParagraph(paragraph: string, correctAnswer: string): string | null {
  const split = splitInsertionParagraph(paragraph);
  if (!split) return null;
  const choice = parseChoiceNumber(correctAnswer);
  if (choice < 1 || choice > 5) return null;
  const pieces = split.body.split(/[①②③④⑤]/u);
  if (pieces.length < 2) return null;
  if (choice > pieces.length - 1) return null;
  const left = pieces.slice(0, choice).join('');
  const right = pieces.slice(choice).join('');
  return (left + split.given + right).trim();
}

/** 보기 한 줄에서 ①~⑤ 접두 제거 후 정답 문구만 */
function extractBlankFillFromOptionLine(line: string, choice: number): string | null {
  let t = line.trim();
  if (!t) return null;
  const circled = ['①', '②', '③', '④', '⑤'][choice - 1];
  if (t.startsWith(circled)) {
    t = t.slice(circled.length).trim();
  } else {
    t = t.replace(new RegExp(`^${choice}\\s*[\\).:．]\\s*`), '').trim();
  }
  t = t.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  if (!t) return null;
  return t;
}

/**
 * 빈칸 표기를 정답 한 덩어리로 치환(첫 매칭만). 여러 패턴 시도.
 */
function replaceFirstBlankSlot(paragraph: string, fill: string): string | null {
  const text = paragraph.replace(/\r\n/g, '\n');
  /** 첫 매칭만 치환 (g 없음) */
  const patterns: RegExp[] = [
    /<u>\s*(?:_{2,}|…+|\.{3,})\s*<\/u>/i,
    /<u>\s{1,40}<\/u>/i,
    /<u>\s*<\/u>/i,
    /_{3,}/u,
    /＿{2,}/u,
    /（\s{1,40}）/u,
    /\(\s{1,40}\)/,
    /\(\s*\)/,
    /（\s*）/u,
    /【\s{1,20}】/u,
  ];
  for (const re of patterns) {
    if (text.search(re) >= 0) {
      const next = text.replace(re, fill);
      if (next !== text) return next;
    }
  }
  return null;
}

function tryReconstructBlankParagraph(
  paragraph: string,
  options: string,
  correctAnswer: string
): string | null {
  const choice = parseChoiceNumber(correctAnswer);
  if (!choice) return null;
  const line = optionsLineForChoice(options, choice);
  if (!line) return null;
  const fill = extractBlankFillFromOptionLine(line, choice);
  if (!fill) return null;
  return replaceFirstBlankSlot(paragraph, fill);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkersAndUnderlineTags(s: string): string {
  return s
    .replace(/<u>([\s\S]*?)<\/u>/gi, '$1')
    .replace(/[①②③④⑤]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseWs(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/** 어절 단위로 정확히 한 칸만 다를 때 원문 어절로 맞춤 */
function mergeSingleWordDiff(p: string, o: string): string | null {
  const pw = p.split(/\s+/).filter(Boolean);
  const ow = o.split(/\s+/).filter(Boolean);
  if (pw.length !== ow.length) return null;
  const diffIdx: number[] = [];
  for (let i = 0; i < pw.length; i++) {
    if (pw[i] !== ow[i]) diffIdx.push(i);
  }
  if (diffIdx.length !== 1) return null;
  const i = diffIdx[0];
  const out = [...pw];
  out[i] = ow[i];
  return out.join(' ');
}

/** ① <u>...</u> 형태 블록 (어법) */
function extractGrammarUnderlineBlocks(paragraph: string): Array<{
  marker: string;
  num: number;
  inner: string;
}> {
  const re = /([①②③④⑤])\s*<u>([\s\S]*?)<\/u>/gi;
  const out: Array<{ marker: string; num: number; inner: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    const num = CIRCLED_NUM[m[1]] ?? 0;
    if (!num) continue;
    out.push({ marker: m[1], num, inner: m[2].trim() });
  }
  return out;
}

/**
 * 어법: CorrectAnswer = 어법상 틀린 번호(①~⑤).
 * 해당 밑줄 부분을 (1) 정답 보기 줄 문구가 다르면 그걸로 교체 (2) 원문과 어절 1곳만 다르면 원문으로 교정.
 * 이후 마커·<u> 제거한 평문으로 비교.
 */
function tryReconstructGrammarParagraph(
  paragraph: string,
  options: string,
  correctAnswer: string,
  original: string
): string | null {
  const wrongNum = parseChoiceNumber(correctAnswer);
  if (wrongNum < 1 || wrongNum > 5) return null;

  const blocks = extractGrammarUnderlineBlocks(paragraph);
  if (blocks.length === 0) return null;

  const target = blocks.find((b) => b.num === wrongNum);
  if (!target) return null;

  let working = paragraph;
  const line = optionsLineForChoice(options, wrongNum);
  const opt = line ? extractBlankFillFromOptionLine(line, wrongNum) : null;
  if (opt && opt !== target.inner) {
    const re = new RegExp(
      `${escapeRegExp(target.marker)}\\s*<u>${escapeRegExp(target.inner)}<\\/u>`,
      'i'
    );
    if (re.test(working)) {
      working = working.replace(re, `${target.marker}<u>${opt}</u>`);
    }
  }

  let plain = stripMarkersAndUnderlineTags(working);
  const origC = collapseWs(original);
  plain = collapseWs(plain);
  const merged = mergeSingleWordDiff(plain, origC);
  if (merged != null) return merged;
  return plain;
}

type QuestionDataLike = {
  Options?: unknown;
  CorrectAnswer?: unknown;
};

/** 변형도 비교 전 문자열 정규화 (유형별) */
export function normalizeTextForVariationCompare(type: string, text: string): string {
  const t = type.trim();
  const s = text.trim();
  if (t === '어법') return collapseWs(s);
  return s;
}

/**
 * 변형도 계산에 쓸 Paragraph 동등 텍스트.
 * 순서·삽입·빈칸·어법은 정답·원문 반영 재구성에 성공하면 그 문자열, 아니면 원본 Paragraph.
 * `original`은 어법 처리 시 필요합니다.
 */
export function paragraphTextForVariationCompare(
  type: string,
  paragraph: string,
  questionData: QuestionDataLike | undefined,
  original?: string
): string {
  const opts = typeof questionData?.Options === 'string' ? questionData.Options : '';
  const ans = typeof questionData?.CorrectAnswer === 'string' ? questionData.CorrectAnswer : '';
  const t = type.trim();

  if (t === '순서') {
    const r = tryReconstructOrderParagraph(paragraph, opts, ans);
    if (r != null) return r;
  }
  if (t === '삽입') {
    const r = tryReconstructInsertionParagraph(paragraph, ans);
    if (r != null) return r;
  }
  if (t === '빈칸') {
    const r = tryReconstructBlankParagraph(paragraph, opts, ans);
    if (r != null) return r;
  }
  if (t === '어법' && original != null && original.trim() !== '') {
    const r = tryReconstructGrammarParagraph(paragraph, opts, ans, original);
    if (r != null) return r;
  }
  return paragraph;
}

export function variationPercentAgainstOriginal(
  type: string,
  original: string,
  paragraph: string,
  questionData: QuestionDataLike | undefined
): number {
  const compareText = paragraphTextForVariationCompare(type, paragraph, questionData, original);
  return Math.round(
    variationRatio(
      normalizeTextForVariationCompare(type, original),
      normalizeTextForVariationCompare(type, compareText)
    ) * 100
  );
}
