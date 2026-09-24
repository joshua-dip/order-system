/**
 * 학습실 — 지문 원문에서 순서·삽입 문항을 **규칙으로 즉석 생성**한다(판매 재고 generated_questions 는 쓰지 않는다).
 *
 * (지문, 유형, seed) 가 같으면 언제나 같은 문항이 나온다 — 채점·오답 복습 때 seed 로 다시 만든다.
 * 정답은 화면에 보내지 않고 채점 요청 때 서버가 다시 만들어 비교한다. 해설은 만들지 않는다.
 *
 * 풀 만한 문항이 되도록, 덩이 시작·빠지는 문장을 고를 때 연결 단서(However·This·For example …)가
 * 있는 자리를 우선한다 — 무작위로 자르면 단서 없이 순서가 여럿 되는 문항이 나온다.
 */

export type PracticeGenKind = '순서' | '삽입';

export const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

/** 순서 보기 — 표준 5세트 고정 */
export const ORDER_OPTIONS = ['(A) - (C) - (B)', '(B) - (A) - (C)', '(B) - (C) - (A)', '(C) - (A) - (B)', '(C) - (B) - (A)'] as const;
/** 보기 번호 → 표시 위치 A·B·C 에 놓을 원래 덩이(읽기 순서 0·1·2) */
const ANSWER_TO_DISPLAY: [number, number, number][] = [
  [0, 2, 1],
  [1, 0, 2],
  [2, 0, 1],
  [1, 2, 0],
  [2, 1, 0],
];

export type GeneratedPractice =
  | {
      kind: '순서';
      intro: string;
      A: string;
      B: string;
      C: string;
      options: readonly string[];
      /** 정답 보기 번호(0~4) — 화면에 보내지 않는다 */
      answerIndex: number;
      /** 채점 뒤 보여 줄 원래 순서의 글 */
      ordered: string[];
    }
  | {
      kind: '삽입';
      given: string;
      /** 마커 ①~⑤ 가 들어간 본문 */
      passage: string;
      answerIndex: number;
      /** 채점 뒤 보여 줄 원문 — 주어진 문장의 자리 */
      restored: { before: string; given: string; after: string };
    };

/* ── 시드 난수 (mulberry32) ── */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** 원문 → 문장. 따옴표 안 대사에서는 끊지 않는다. */
export function splitPassageSentences(original: string): string[] {
  const text = original.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '“') inQuote = true;
    else if (ch === '”') inQuote = false;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let j = i + 1;
    let after: boolean = inQuote;
    while (j < text.length && /["”'’)]/.test(text[j])) {
      if (text[j] === '"') after = !after;
      else if (text[j] === '”') after = false;
      j++;
    }
    if (!after && text[j] === ' ' && /[A-Z"“(]/.test(text[j + 1] ?? '')) {
      out.push(text.slice(start, j).trim());
      start = j + 1;
      inQuote = after;
      i = j;
    }
  }
  if (start < text.length) out.push(text.slice(start).trim());
  /* 너무 짧은 조각(약어 끊김 등)은 앞 문장에 붙인다 */
  const merged: string[] = [];
  for (const s of out) {
    if (s.length < 12 && merged.length) merged[merged.length - 1] += ` ${s}`;
    else merged.push(s);
  }
  return merged;
}

/** 문장 앞머리 연결 단서 — 앞 문장이 있어야 성립하는 시작 */
const CUE_START = /^["“]?(However|But|Yet|Instead|Still|Nevertheless|Nonetheless|Therefore|Thus|Hence|Consequently|As a result|For example|For instance|In addition|Moreover|Furthermore|Besides|Also|Similarly|Likewise|In contrast|On the other hand|In other words|That is|Then|Finally|Afterward|Later|This|These|That|Those|Such|It|They|He|She|His|Her|Their|Its|The same|Another|Other|Both|Otherwise|Meanwhile|In fact|Indeed|So)\b/;

function cueScore(sentence: string | undefined): number {
  if (!sentence) return 0;
  return CUE_START.test(sentence.trim()) ? 1 : 0;
}

/** 가중 무작위 — 점수가 높을수록 자주 뽑힌다 */
function weightedPick<T>(items: T[], weight: (x: T) => number, r: () => number): T {
  const ws = items.map((x) => Math.max(0.05, weight(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  let t = r() * total;
  for (let i = 0; i < items.length; i++) {
    t -= ws[i];
    if (t <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** 순서: 도입 1~2문장 + 연속 3덩이. 덩이 시작은 단서 문장을 우선. */
export function generateOrder(sentences: string[], seed: number): GeneratedPractice | null {
  const n = sentences.length;
  if (n < 5) return null;
  const r = rng(seed);
  const introLen = n >= 9 && r() < 0.5 ? 2 : 1;
  const rest = n - introLen;
  if (rest < 3) return null;
  /* 경계 두 곳(b1<b2) 후보 — 덩이 크기 차이가 너무 크지 않게 */
  const minSize = rest >= 6 ? 2 : 1;
  const cands: [number, number][] = [];
  for (let b1 = minSize; b1 <= rest - 2 * minSize; b1++) {
    for (let b2 = b1 + minSize; b2 <= rest - minSize; b2++) {
      const sizes = [b1, b2 - b1, rest - b2];
      if (Math.max(...sizes) - Math.min(...sizes) > Math.max(2, Math.ceil(rest / 3))) continue;
      cands.push([b1, b2]);
    }
  }
  if (!cands.length) return null;
  const body = sentences.slice(introLen);
  const [b1, b2] = weightedPick(
    cands,
    ([x, y]) => 1 + 2 * (cueScore(body[x]) + cueScore(body[y])) + cueScore(body[0]),
    r,
  );
  const chunks = [body.slice(0, b1), body.slice(b1, b2), body.slice(b2)].map((c) => c.join(' '));
  const answerIndex = Math.floor(r() * 5);
  const disp = ANSWER_TO_DISPLAY[answerIndex];
  return {
    kind: '순서',
    intro: sentences.slice(0, introLen).join(' '),
    A: chunks[disp[0]],
    B: chunks[disp[1]],
    C: chunks[disp[2]],
    options: ORDER_OPTIONS,
    answerIndex,
    ordered: [sentences.slice(0, introLen).join(' '), ...chunks],
  };
}

/** 삽입: 첫 문장이 아닌 한 문장을 빼고, 연속한 다섯 틈에 ①~⑤. 앞뒤 단서가 있는 문장을 우선. */
export function generateInsert(sentences: string[], seed: number): GeneratedPractice | null {
  const n = sentences.length;
  if (n < 6) return null;
  const r = rng(seed);
  /* 정답 번호를 먼저 고르게 뽑는다 — 뺄 문장부터 고르면 앞쪽 문장일 때 ①만 가능해 ①이 쏠린다.
     m = 남는 문장 수(n-1), 틈 g = remain[g] 앞(1..m). 정답 a 이면 t 는 a+1 .. m-4+a 사이여야 한다. */
  const m = n - 1;
  if (m < 5) return null;
  const answerIndex = Math.floor(r() * 5);
  const ts: number[] = [];
  for (let t = answerIndex + 1; t <= m - 4 + answerIndex; t++) ts.push(t);
  if (!ts.length) return null;
  /* 자신이나 다음 문장이 단서로 시작하면 자리가 하나로 좁혀진다 — 그런 문장을 우선 */
  const t = weightedPick(ts, (i) => 1 + 2 * cueScore(sentences[i]) + 2 * cueScore(sentences[i + 1]), r);
  const remain = sentences.filter((_, i) => i !== t);
  const s = t - answerIndex;
  const parts: string[] = [remain[0]];
  for (let g = 1; g <= m; g++) {
    const inWin = g >= s && g <= s + 4;
    if (inWin) parts.push(`( ${CIRCLED[g - s]} )`);
    if (g < m) parts.push(remain[g]);
  }
  return {
    kind: '삽입',
    given: sentences[t],
    passage: parts.join(' '),
    answerIndex,
    restored: { before: sentences[t - 1] ?? '', given: sentences[t], after: sentences[t + 1] ?? '' },
  };
}

export function generatePractice(kind: PracticeGenKind, sentences: string[], seed: number): GeneratedPractice | null {
  return kind === '순서' ? generateOrder(sentences, seed) : generateInsert(sentences, seed);
}
