/**
 * 순서배열 워크북 — 셔플 매핑 + HTML 렌더러.
 *
 * 두 가지 형식:
 *   - 'choice' (3분할): 표준 모의고사 「글의 순서」 — 도입 + (A)(B)(C), 보기 5세트 고정.
 *   - 'arrange' (4분할 이상·전체 문장 분할): (A)(B)(C)(D)… 를 섞어 보여주고
 *     학생이 올바른 순서를 직접 적음. 답지에 정답 순서(예: (C)-(A)-(D)-(B)) 표시.
 *
 * 데이터 모델: `chunks` 는 항상 "원본(정답) 순서". `displayOrder` 가 화면 표시 순서를 정함.
 *   - display 위치 d 의 박스 라벨 = LETTERS[d], 내용 = chunks[displayOrder[d]].
 */

export type AnswerKey = 1 | 2 | 3 | 4 | 5;
export type SentenceOrderFormat = 'choice' | 'arrange';

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

/** 'choice'(3분할) 전용 — 정답 번호 → display 순열(원본 chunk index). */
export const ANSWER_TO_DISPLAY: Record<AnswerKey, [number, number, number]> = {
  1: [0, 2, 1], // (A)-(C)-(B): P1=A, P2=C, P3=B
  2: [1, 0, 2], // (B)-(A)-(C)
  3: [2, 0, 1], // (B)-(C)-(A)
  4: [1, 2, 0], // (C)-(A)-(B)
  5: [2, 1, 0], // (C)-(B)-(A)
};

export const ANSWER_LABEL: Record<AnswerKey, string> = {
  1: '① (A) - (C) - (B)',
  2: '② (B) - (A) - (C)',
  3: '③ (B) - (C) - (A)',
  4: '④ (C) - (A) - (B)',
  5: '⑤ (C) - (B) - (A)',
};

export const CIRCLED: Record<AnswerKey, string> = {
  1: '①',
  2: '②',
  3: '③',
  4: '④',
  5: '⑤',
};

/** 'choice' 학생용 보기(ol) 텍스트 — 5세트 고정. */
const CHOICE_OPTION_LABELS = [
  '① (A) - (C) - (B)',
  '② (B) - (A) - (C)',
  '③ (B) - (C) - (A)',
  '④ (C) - (A) - (B)',
  '⑤ (C) - (B) - (A)',
];
/** 각 보기의 정답 라벨 시퀀스(원본 순서대로 박스 라벨). */
const CHOICE_OPTION_SEQS = [
  ['A', 'C', 'B'],
  ['B', 'A', 'C'],
  ['B', 'C', 'A'],
  ['C', 'A', 'B'],
  ['C', 'B', 'A'],
];

/** 1~5 중 무작위 정답 번호. */
export function randomAnswer(): AnswerKey {
  return ((Math.floor(Math.random() * 5) + 1) as AnswerKey);
}

/** 0..n-1 의 항등이 아닌 무작위 순열(Fisher–Yates). */
export function randomPermutation(n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  if (n <= 1) return perm;
  for (let tries = 0; tries < 50; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    if (perm.some((v, i) => v !== i)) break; // 항등 회피
  }
  return perm;
}

/** displayOrder → 정답 순서(원본 순서대로 읽었을 때 박스 라벨 시퀀스). */
export function answerLabelSequence(displayOrder: number[]): string[] {
  const n = displayOrder.length;
  const posOf = new Array<number>(n);
  displayOrder.forEach((origIdx, d) => { posOf[origIdx] = d; });
  return Array.from({ length: n }, (_, k) => LETTERS[posOf[k]] ?? '?');
}

/** 'arrange' 정답 문자열 — 예: "(C) - (A) - (D) - (B)". */
export function arrangeAnswerString(displayOrder: number[]): string {
  return answerLabelSequence(displayOrder).map(l => `(${l})`).join(' - ');
}

/** 'choice' displayOrder → 표준 보기 라벨(매칭 실패 시 시퀀스 직접 표기). */
function choiceAnswerLabel(displayOrder: number[]): string {
  const seq = answerLabelSequence(displayOrder).join('');
  const i = CHOICE_OPTION_SEQS.findIndex(s => s.join('') === seq);
  return i >= 0 ? CHOICE_OPTION_LABELS[i] : arrangeAnswerString(displayOrder);
}

/**
 * 문장 배열을 (도입 1 + ) count개 chunk 로 균등 분할(원본 순서 유지).
 * - withIntro 이고 문장 수가 count 보다 많으면 첫 문장을 도입으로 뺀다.
 * - 각 chunk 는 최소 1문장 보장(나눌 문장이 count 미만이면 null).
 */
export function splitIntoChunks(
  sentences: string[],
  count: number,
  withIntro: boolean,
): { intro: string; chunks: string[] } | null {
  const n = sentences.length;
  let start = 0;
  let intro = '';
  if (withIntro && n > count) {
    intro = sentences[0] ?? '';
    start = 1;
  }
  const rest = n - start;
  if (rest < count || count < 1) return null;
  const base = Math.floor(rest / count);
  const extra = rest % count;
  const chunks: string[] = [];
  let pos = start;
  for (let g = 0; g < count; g++) {
    const size = base + (g < extra ? 1 : 0);
    chunks.push(sentences.slice(pos, pos + size).join(' '));
    pos += size;
  }
  return { intro, chunks };
}

export interface SentenceOrderItem {
  /** 표시용 제목 (예: "1. 26년 3월 고1 30번") */
  title: string;
  textbook?: string;
  sourceKey?: string;
  /** 도입(intro) 영문. 빈 문자열이면 도입 없는 형태로 렌더. */
  intro: string;
  /** 도입 한국어 해석. 답지 페이지에서만 노출. */
  introKo?: string;
  /** 원본(정답) 순서의 chunk들. 길이 N (>=3). */
  chunks: string[];
  /** 원본 순서의 한국어 해석 (chunks 와 인덱스 정합). */
  chunksKo?: string[];
  /** 화면 표시 순열. display 위치 d → 원본 chunk index. 길이 = chunks.length. */
  displayOrder: number[];
  /** 'choice' = 3분할 5지선다, 'arrange' = N분할 배열형. */
  format: SentenceOrderFormat;
}

export interface SentenceOrderRenderOpts {
  title: string;
  /** 페이지에 표시할 문제 항목들 (1개 이상). */
  items: SentenceOrderItem[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** display 순서대로 박스(라벨 + 영문 + 한국어). */
function boxesInDisplayOrder(item: SentenceOrderItem): { label: string; en: string; ko: string }[] {
  return item.displayOrder.map((origIdx, d) => ({
    label: LETTERS[d] ?? '?',
    en: item.chunks[origIdx] ?? '',
    ko: item.chunksKo?.[origIdx] ?? '',
  }));
}

function studentPrompt(item: SentenceOrderItem): string {
  if (item.format === 'choice') {
    return '다음 글에 이어질 글의 순서로 가장 적절한 것을 고르시오.';
  }
  const last = LETTERS[item.chunks.length - 1] ?? '';
  return item.intro
    ? `주어진 글 다음에 이어질 (A)~(${last}) 를 글의 흐름에 맞게 순서대로 배열하시오.`
    : `(A)~(${last}) 를 글의 흐름에 맞게 순서대로 배열하시오.`;
}

const BASE_STYLES = `
  body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; line-height: 1.7; color: #111; padding: 24px; max-width: 780px; margin: 0 auto; }
  h1.title { font-size: 18px; margin: 0 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #222; }
  .item { margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px dashed #aaa; }
  .item:last-child { border-bottom: none; }
  .item-head { font-size: 13px; font-weight: 700; margin-bottom: 6px; color: #333; }
  .item-meta { font-size: 11px; color: #666; margin-bottom: 10px; }
  .intro { margin: 8px 0 14px 0; padding: 10px 12px; background: #f5f5f5; border-left: 3px solid #888; font-size: 14px; }
  .chunk { margin: 8px 0; padding: 10px 12px; border: 1px solid #888; border-radius: 4px; font-size: 14px; }
  .chunk-label { font-weight: 700; margin-right: 6px; }
  .options { margin-top: 12px; font-size: 13px; }
  .options ol { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .options li { white-space: nowrap; }
  .arrange-blank { margin-top: 14px; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; }
  .arrange-blank .lead { font-weight: 700; margin-right: 8px; }
  .answer { margin-top: 6px; font-size: 12px; color: #b91c1c; font-weight: 700; }
  .ans-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 9px 12px; border: 1px solid #ddd; border-radius: 4px; margin: 6px 0; font-size: 14px; }
  .ans-row .ans-q { color: #333; font-weight: 600; }
  .ans-row .ans-val { color: #b91c1c; font-weight: 700; white-space: nowrap; }
  .ko { margin: 4px 0 0 0; font-size: 12px; color: #2563eb; }
  .page-break { page-break-before: always; }
  @media print {
    body { padding: 16px; }
    .no-print { display: none !important; }
  }
`;

/** 한 문제 카드 — 학생용 (정답·해석 미노출). */
function renderItemStudent(item: SentenceOrderItem, idx: number): string {
  const meta =
    item.textbook || item.sourceKey
      ? `<div class="item-meta">${escapeHtml([item.textbook ?? '', item.sourceKey ?? ''].filter(Boolean).join(' · '))}</div>`
      : '';
  const intro = item.intro ? `<div class="intro">${escapeHtml(item.intro)}</div>` : '';
  const boxes = boxesInDisplayOrder(item)
    .map(b => `<div class="chunk"><span class="chunk-label">(${b.label})</span>${escapeHtml(b.en)}</div>`)
    .join('\n      ');
  let tail = '';
  if (item.format === 'choice') {
    tail = `<div class="options"><ol>${CHOICE_OPTION_LABELS.map(l => `<li>${l}</li>`).join('')}</ol></div>`;
  } else {
    const blanks = item.chunks.map(() => '(　　)').join(' → ');
    tail = `<div class="arrange-blank"><span class="lead">순서:</span>${blanks}</div>`;
  }
  return `
    <article class="item">
      <div class="item-head">${idx + 1}. ${escapeHtml(item.title)} — ${studentPrompt(item)}</div>
      ${meta}
      ${intro}
      ${boxes}
      ${tail}
    </article>
  `;
}

/** 한 문제 — 답지(정답만 간단히, 한 줄). */
function renderItemAnswer(item: SentenceOrderItem, idx: number): string {
  const answerStr = item.format === 'choice' ? choiceAnswerLabel(item.displayOrder) : arrangeAnswerString(item.displayOrder);
  return `
    <div class="ans-row">
      <span class="ans-q">${idx + 1}. ${escapeHtml(item.title)}</span>
      <span class="ans-val">정답: ${answerStr}</span>
    </div>
  `;
}

/** 학생용 페이지만 (1쪽). */
export function buildSentenceOrderStudentHtml(opts: SentenceOrderRenderOpts): string {
  const body = opts.items.map((it, i) => renderItemStudent(it, i)).join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>${BASE_STYLES}</style></head>
<body>
<h1 class="title">${escapeHtml(opts.title)}</h1>
${body}
</body></html>`;
}

/** 학생용 + 답지(2쪽 분리). 인쇄/PDF 용. */
export function buildSentenceOrderCombinedHtml(opts: SentenceOrderRenderOpts): string {
  const studentBody = opts.items.map((it, i) => renderItemStudent(it, i)).join('\n');
  const answerBody = opts.items.map((it, i) => renderItemAnswer(it, i)).join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>${BASE_STYLES}</style></head>
<body>
<h1 class="title">${escapeHtml(opts.title)}</h1>
${studentBody}
<div class="page-break"></div>
<h1 class="title">${escapeHtml(opts.title)} — 정답</h1>
${answerBody}
</body></html>`;
}
