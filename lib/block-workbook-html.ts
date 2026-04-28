/**
 * 블록 빈칸 워크북 — HTML 렌더러.
 *
 * 출력은 단순 HTML 문자열. 학생용 본문(빈칸 마스킹) 과 보기 박스, 그리고
 * C형은 별도 답안 영역(밑줄 2줄)을 포함한다. 인쇄 친화적인 미니멀 인라인 스타일.
 *
 * 저장 시 그대로 DB 에 넣고, 페이지에서는 srcDoc 또는 dangerouslySetInnerHTML 로 미리보기.
 */

import {
  BlockWorkbookSelection,
  SelectionBlock,
  SentenceTokenized,
  WorkbookKind,
} from './block-workbook-types';

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "_" 반복으로 빈칸 길이를 만든다. 학생용 본문에서 마스킹된 토큰 길이를 시각적으로 유지. */
function blankFor(text: string): string {
  const trimmed = text.replace(/[.,;:!?"]+$/g, '');
  const len = Math.max(6, Math.min(20, trimmed.length + 2));
  return '_'.repeat(len);
}

/** 토큰을 합칠 때 끝에 붙은 구두점을 보존. 본문 재구성용. */
function joinTokens(tokens: string[]): string {
  return tokens.join(' ').replace(/\s+([,.;:!?])/g, '$1');
}

/** 블록을 sentenceIdx 오름차순, startTokenIdx 오름차순으로 정렬. */
function sortBlocks(blocks: SelectionBlock[]): SelectionBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
    return a.startTokenIdx - b.startTokenIdx;
  });
}

// ── A·B 형: 마스킹된 본문 빌더 ─────────────────────────────────────────────────

interface MaskedRender {
  /** 마스킹된 본문 HTML (각 빈칸은 <span class="bw-blank">____</span>) */
  body: string;
  /** 보기 박스에 들어갈 텍스트 목록 (블록 원문, 알파벳순 정렬 후) */
  bogiItems: string[];
}

/** 단어/구 블록만 받아 본문 마스킹 + 보기 목록 추출. */
function renderMaskedBody(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
  kindFilter: ('word' | 'phrase')[],
): MaskedRender {
  const filtered = blocks.filter(b => (kindFilter as string[]).includes(b.kind));
  const sorted = sortBlocks(filtered);
  const bogiItems: string[] = [];

  const sentenceHtmls = sentences.map(s => {
    const blocksHere = sorted.filter(b => b.sentenceIdx === s.idx);
    if (blocksHere.length === 0) {
      return escapeHtml(s.text);
    }
    /** 토큰을 인덱스 별로 보면서 블록에 들어가면 마스킹, 블록 시작점에서만 한 번 출력. */
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const block = blocksHere.find(b => b.startTokenIdx === i);
      if (block) {
        const phrase = joinTokens(s.tokens.slice(block.startTokenIdx, block.endTokenIdx + 1));
        bogiItems.push(phrase);
        out.push(`<span class="bw-blank">${escapeHtml(blankFor(phrase))}</span>`);
        i = block.endTokenIdx + 1;
        continue;
      }
      // 토큰이 어떤 블록 중간에도 없으면 그대로 출력
      const inMid = blocksHere.some(b => i > b.startTokenIdx && i <= b.endTokenIdx);
      if (!inMid) {
        out.push(escapeHtml(s.tokens[i]));
      }
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });

  /** 알파벳순 정렬 (대소문자 구분 X). 중복은 그대로 두되 동일 어형은 한 번만 노출하고 싶다면 set. */
  const sortedItems = [...bogiItems].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return {
    body: sentenceHtmls.join(' '),
    bogiItems: sortedItems,
  };
}

// ── C 형: 문장 영작 본문 빌더 ──────────────────────────────────────────────────

interface SentenceEssayRender {
  /** 본문에서 문장 블록 자리는 한국어 해석으로 대체된 HTML */
  body: string;
  /** 학생이 영작해야 하는 문장 목록 (인덱스 + 원문 + 한국어 해석) */
  items: Array<{
    idx: number;
    english: string;
    korean: string;
    wordCount: number;
  }>;
}

function renderSentenceEssayBody(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
): SentenceEssayRender {
  const sentenceBlocks = blocks.filter(b => b.kind === 'sentence');
  const items: SentenceEssayRender['items'] = [];

  const sentenceHtmls = sentences.map(s => {
    const block = sentenceBlocks.find(b => b.sentenceIdx === s.idx);
    if (!block) return escapeHtml(s.text);
    const korean = (block.koreanMeaning ?? '').trim();
    const english = s.text;
    const wordCount = english.replace(/[,.;:!?"]/g, ' ').split(/\s+/).filter(Boolean).length;
    items.push({ idx: s.idx, english, korean, wordCount });
    const koreanHtml = korean
      ? `<span class="bw-korean">[${escapeHtml(korean)}]</span>`
      : `<span class="bw-korean bw-korean-empty">[한국어 해석 미입력]</span>`;
    return koreanHtml;
  });

  return {
    body: sentenceHtmls.join(' '),
    items,
  };
}

// ── 공통 CSS ───────────────────────────────────────────────────────────────────

const SHARED_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "맑은 고딕", "Malgun Gothic", sans-serif; color: #1f2937; line-height: 1.7; padding: 24px 32px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 18pt; margin: 0 0 6pt; }
  h2 { font-size: 12pt; margin: 14pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #1f2937; }
  .bw-meta { font-size: 10pt; color: #4b5563; margin-bottom: 12pt; }
  .bw-passage { font-size: 11pt; line-height: 1.85; padding: 10pt 12pt; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
  .bw-blank { display: inline-block; min-width: 60px; border-bottom: 1.5px solid #1f2937; padding: 0 4px; color: transparent; user-select: none; }
  .bw-korean { color: #1f2937; background: #fef3c7; border: 1px dashed #d97706; padding: 1px 6px; border-radius: 4px; font-style: normal; }
  .bw-korean-empty { color: #b45309; background: #fffbeb; }
  .bw-bogi { margin-top: 12pt; padding: 8pt 12pt; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; }
  .bw-bogi-label { font-weight: 700; color: #1e3a8a; margin-bottom: 4pt; font-size: 10pt; }
  .bw-bogi-list { font-size: 11pt; }
  .bw-bogi-list .item { display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0; background: white; border: 1px solid #93c5fd; border-radius: 4px; }
  .bw-essay-q { margin-top: 14pt; padding: 10pt 12pt; border: 1px solid #e5e7eb; border-radius: 6px; }
  .bw-essay-q .num { font-weight: 700; color: #1f2937; margin-right: 6px; }
  .bw-essay-q .ko { background: #fef3c7; padding: 2px 6px; border-radius: 4px; }
  .bw-write-row { border-bottom: 1px solid #6b7280; height: 16pt; margin-top: 6pt; }
  .bw-condition { margin-top: 6pt; font-size: 10pt; color: #4b5563; }
`;

// ── 공개: 워크북별 HTML 빌더 ────────────────────────────────────────────────────

interface BuildOptions {
  title: string;
  textbook: string;
  sourceKey: string;
  selection: BlockWorkbookSelection;
}

function header({ title, textbook, sourceKey }: BuildOptions): string {
  return `<h1>${escapeHtml(title)}</h1>
<div class="bw-meta">${escapeHtml(textbook)} · ${escapeHtml(sourceKey)}</div>`;
}

export function buildWordBlankHtml(opts: BuildOptions): string {
  const { body, bogiItems } = renderMaskedBody(
    opts.selection.sentences,
    opts.selection.blocks,
    ['word'],
  );
  const bogiHtml = bogiItems.length
    ? `<div class="bw-bogi">
  <div class="bw-bogi-label">▸ 보기 (알파벳순)</div>
  <div class="bw-bogi-list">${bogiItems.map(w => `<span class="item">${escapeHtml(w)}</span>`).join('')}</div>
</div>`
    : '<div class="bw-meta">선택된 단어 블록이 없습니다.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)} — 단어 빈칸</title><style>${SHARED_CSS}</style></head><body>
${header(opts)}
<h2>A. 단어 빈칸</h2>
<div class="bw-passage">${body}</div>
${bogiHtml}
</body></html>`;
}

export function buildPhraseBlankHtml(opts: BuildOptions): string {
  const { body, bogiItems } = renderMaskedBody(
    opts.selection.sentences,
    opts.selection.blocks,
    ['phrase'],
  );
  const bogiHtml = bogiItems.length
    ? `<div class="bw-bogi">
  <div class="bw-bogi-label">▸ 보기 — 구·표현 (알파벳순)</div>
  <div class="bw-bogi-list">${bogiItems.map(w => `<span class="item">${escapeHtml(w)}</span>`).join('')}</div>
</div>`
    : '<div class="bw-meta">선택된 구 블록이 없습니다.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)} — 구 빈칸</title><style>${SHARED_CSS}</style></head><body>
${header(opts)}
<h2>B. 구·표현 빈칸</h2>
<div class="bw-passage">${body}</div>
${bogiHtml}
</body></html>`;
}

export function buildSentenceEssayHtml(opts: BuildOptions): string {
  const { body, items } = renderSentenceEssayBody(opts.selection.sentences, opts.selection.blocks);

  const questionHtml = items.length
    ? items
        .map(
          (it, i) => `<div class="bw-essay-q">
  <div><span class="num">${i + 1}.</span> 다음 한국어 해석에 부합하도록 영어 문장을 작성하세요.</div>
  <div class="bw-condition">▸ 한국어 해석: <span class="ko">${escapeHtml(it.korean || '(미입력)')}</span></div>
  <div class="bw-condition">▸ 작성 단어 수: <b>${it.wordCount}개</b></div>
  <div class="bw-write-row"></div>
  <div class="bw-write-row"></div>
</div>`,
        )
        .join('\n')
    : '<div class="bw-meta">선택된 문장 블록이 없습니다.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)} — 문장 영작</title><style>${SHARED_CSS}</style></head><body>
${header(opts)}
<h2>C. 문장 영작</h2>
<div class="bw-passage">${body}</div>
${questionHtml}
</body></html>`;
}

/** 모든 활성 유형의 HTML 을 한 번에 빌드. 비활성 유형은 undefined 로 둔다. */
export function buildAllHtml(
  opts: BuildOptions,
  types: WorkbookKind[],
): Partial<Record<WorkbookKind, string>> {
  const out: Partial<Record<WorkbookKind, string>> = {};
  if (types.includes('A')) out.A = buildWordBlankHtml(opts);
  if (types.includes('B')) out.B = buildPhraseBlankHtml(opts);
  if (types.includes('C')) out.C = buildSentenceEssayHtml(opts);
  return out;
}
