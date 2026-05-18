/**
 * 순서배열(ABC 셔플) 워크북 — 셔플 매핑 + HTML 렌더러.
 *
 * 표준 모의고사 「글의 순서」 형식:
 *   - 도입(intro) + (A)(B)(C) 3 chunk 로 본문 분할
 *   - (A)(B)(C) 박스는 원본 순서가 아닌 비-항등 순열로 셔플 표시
 *   - 보기는 5세트 고정: ① (A)-(C)-(B) ~ ⑤ (C)-(B)-(A)
 */

export type AnswerKey = 1 | 2 | 3 | 4 | 5;

/** 정답 번호 → 표시할 라벨 [A,B,C] 가 원본 chunk index 0/1/2 중 어떤 것인지. */
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

/** 1~5 중 무작위 정답 번호. */
export function randomAnswer(): AnswerKey {
  return ((Math.floor(Math.random() * 5) + 1) as AnswerKey);
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
  /** 원본 순서의 3개 chunk. */
  chunks: [string, string, string];
  /** 원본 순서의 한국어 해석 (chunks 와 인덱스 정합). */
  chunksKo?: [string, string, string];
  /** 정답 번호 1~5. */
  answer: AnswerKey;
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
  .answer { margin-top: 6px; font-size: 12px; color: #b91c1c; font-weight: 700; }
  .ko { margin: 4px 0 0 0; font-size: 12px; color: #2563eb; }
  .page-break { page-break-before: always; }
  @media print {
    body { padding: 16px; }
    .no-print { display: none !important; }
  }
`;

/** 한 문제 카드 — 학생용 (정답·해석 미노출). */
function renderItemStudent(item: SentenceOrderItem, idx: number): string {
  const [a, b, c] = ANSWER_TO_DISPLAY[item.answer].map(i => item.chunks[i]);
  const meta =
    item.textbook || item.sourceKey
      ? `<div class="item-meta">${escapeHtml([item.textbook ?? '', item.sourceKey ?? ''].filter(Boolean).join(' · '))}</div>`
      : '';
  const intro = item.intro
    ? `<div class="intro">${escapeHtml(item.intro)}</div>`
    : '';
  return `
    <article class="item">
      <div class="item-head">${idx + 1}. ${escapeHtml(item.title)} — 다음 글에 이어질 글의 순서로 가장 적절한 것을 고르시오.</div>
      ${meta}
      ${intro}
      <div class="chunk"><span class="chunk-label">(A)</span>${escapeHtml(a)}</div>
      <div class="chunk"><span class="chunk-label">(B)</span>${escapeHtml(b)}</div>
      <div class="chunk"><span class="chunk-label">(C)</span>${escapeHtml(c)}</div>
      <div class="options">
        <ol>
          <li>① (A) - (C) - (B)</li>
          <li>② (B) - (A) - (C)</li>
          <li>③ (B) - (C) - (A)</li>
          <li>④ (C) - (A) - (B)</li>
          <li>⑤ (C) - (B) - (A)</li>
        </ol>
      </div>
    </article>
  `;
}

/** 한 문제 카드 — 답지 (정답 + 한국어 해석 노출). */
function renderItemAnswer(item: SentenceOrderItem, idx: number): string {
  const display = ANSWER_TO_DISPLAY[item.answer];
  const [a, b, c] = display.map(i => item.chunks[i]);
  const koArr = item.chunksKo;
  const [aKo, bKo, cKo] = display.map(i => koArr?.[i] ?? '');
  const meta =
    item.textbook || item.sourceKey
      ? `<div class="item-meta">${escapeHtml([item.textbook ?? '', item.sourceKey ?? ''].filter(Boolean).join(' · '))}</div>`
      : '';
  const intro = item.intro
    ? `<div class="intro">${escapeHtml(item.intro)}${item.introKo ? `<div class="ko">${escapeHtml(item.introKo)}</div>` : ''}</div>`
    : '';
  const renderChunk = (label: string, en: string, ko: string) => `
    <div class="chunk">
      <span class="chunk-label">(${label})</span>${escapeHtml(en)}
      ${ko ? `<div class="ko">${escapeHtml(ko)}</div>` : ''}
    </div>
  `;
  return `
    <article class="item">
      <div class="item-head">${idx + 1}. ${escapeHtml(item.title)} — 정답</div>
      ${meta}
      ${intro}
      ${renderChunk('A', a, aKo)}
      ${renderChunk('B', b, bKo)}
      ${renderChunk('C', c, cKo)}
      <div class="answer">정답: ${ANSWER_LABEL[item.answer]}</div>
    </article>
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
<h1 class="title">${escapeHtml(opts.title)} — 정답·해석</h1>
${answerBody}
</body></html>`;
}
