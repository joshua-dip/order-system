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
        const tokenCount = block.endTokenIdx - block.startTokenIdx + 1;
        const phraseKorean = block.kind === 'phrase' ? (block.koreanMeaning ?? '').trim() : '';
        const hint = block.kind === 'phrase'
          ? phraseKorean
            ? ` <span class="bw-blank-hint">(${tokenCount}단어 · ${escapeHtml(phraseKorean)})</span>`
            : ` <span class="bw-blank-hint">(${tokenCount}단어)</span>`
          : '';
        out.push(`<span class="bw-blank">${escapeHtml(blankFor(phrase))}</span>${hint}`);
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
    const korean = ((block.koreanMeaning ?? '').trim() || (s.korean ?? '').trim());
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

// ── 통합형: 한 지문에 단어·구·문장 빈칸 동시 마스킹 ──────────────────────────────

interface UnifiedRender {
  /** 마스킹된 본문 HTML — 한 지문 안에 word/phrase 는 번호 빈칸으로, sentence 는 한국어로 */
  body: string;
  /** 빈칸 정답 목록 (출현 순 — ①②③… 와 1:1) */
  blankAnswers: { label: string; kind: 'word' | 'phrase'; original: string }[];
  /** 문장 영작 항목 (질문지·답지 양쪽에서 번호 1, 2, 3 으로 사용) */
  essayItems: { num: number; english: string; korean: string; wordCount: number }[];
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function blankLabel(n: number): string {
  return n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

/**
 * 활성화된 kind 만 마스킹한 본문을 만든다.
 * - 같은 문장에 sentence 블록이 있으면 그 문장 전체를 한국어로 치환하고 내부 단어·구 마스킹은 생략 (sentence 가 우위).
 * - word ⊂ phrase 가 있으면 phrase 가 우위 (더 큰 범위).
 * - 동일 kind 끼리 토큰 범위가 겹치면 시작 인덱스가 빠른 쪽이 우위 (단순 결정적 규칙).
 */
function renderUnifiedMaskedBody(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
  activeKinds: ReadonlySet<'word' | 'phrase' | 'sentence'>,
  showKorean: boolean,
): UnifiedRender {
  const blankAnswers: UnifiedRender['blankAnswers'] = [];
  const essayItems: UnifiedRender['essayItems'] = [];
  let blankCounter = 0;
  let essayCounter = 0;

  /** kind 우선순위: sentence > phrase > word (큰 범위가 이긴다) */
  const kindRank: Record<'word' | 'phrase' | 'sentence', number> = {
    word: 0,
    phrase: 1,
    sentence: 2,
  };

  const sentenceHtmls = sentences.map(s => {
    const here = blocks.filter(b => b.sentenceIdx === s.idx && activeKinds.has(b.kind));
    if (here.length === 0) return escapeHtml(s.text);

    const sentBlock = here.find(b => b.kind === 'sentence');
    if (sentBlock) {
      const korean = ((sentBlock.koreanMeaning ?? '').trim() || (s.korean ?? '').trim());
      const english = s.text;
      const wordCount = english.replace(/[,.;:!?"]/g, ' ').split(/\s+/).filter(Boolean).length;
      essayCounter += 1;
      essayItems.push({ num: essayCounter, english, korean, wordCount });
      if (!showKorean) {
        return `<span class="bw-blank bw-blank-sentence">[${essayCounter}] ${'_'.repeat(40)}</span>`;
      }
      return korean
        ? `<span class="bw-korean">[${essayCounter}] ${escapeHtml(korean)}</span>`
        : `<span class="bw-korean bw-korean-empty">[${essayCounter}] (한국어 해석 미입력)</span>`;
    }

    const sorted = [...here].sort((a, b) => {
      if (a.startTokenIdx !== b.startTokenIdx) return a.startTokenIdx - b.startTokenIdx;
      return kindRank[b.kind] - kindRank[a.kind];
    });

    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const candidates = sorted.filter(b => b.startTokenIdx === i);
      const block = candidates[0];
      if (block) {
        const phrase = joinTokens(s.tokens.slice(block.startTokenIdx, block.endTokenIdx + 1));
        const kind = block.kind === 'phrase' ? 'phrase' : 'word';
        blankCounter += 1;
        const label = blankLabel(blankCounter);
        blankAnswers.push({ label, kind, original: phrase });
        const cls = kind === 'phrase' ? 'bw-blank bw-blank-phrase' : 'bw-blank bw-blank-word';
        const tokenCount = block.endTokenIdx - block.startTokenIdx + 1;
        const phraseKorean = kind === 'phrase' && showKorean ? (block.koreanMeaning ?? '').trim() : '';
        const hint = kind === 'phrase'
          ? phraseKorean
            ? ` <span class="bw-blank-hint">(${tokenCount}단어 · ${escapeHtml(phraseKorean)})</span>`
            : ` <span class="bw-blank-hint">(${tokenCount}단어)</span>`
          : '';
        out.push(`<span class="bw-blank-num">${escapeHtml(label)}</span><span class="${cls}">${escapeHtml(blankFor(phrase))}</span>${hint}`);
        i = block.endTokenIdx + 1;
        continue;
      }
      const inMid = sorted.some(b => i > b.startTokenIdx && i <= b.endTokenIdx);
      if (!inMid) out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });

  return {
    body: sentenceHtmls.join(' '),
    blankAnswers,
    essayItems,
  };
}

// ── 공통 CSS ───────────────────────────────────────────────────────────────────

const SHARED_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "맑은 고딕", "Malgun Gothic", sans-serif; color: #1f2937; line-height: 1.7; padding: 24px 32px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 18pt; margin: 0 0 6pt; }
  h2 { font-size: 12pt; margin: 14pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #1f2937; }
  .bw-meta { font-size: 10pt; color: #4b5563; margin-bottom: 12pt; }
  .bw-warning { margin: 6pt 0; padding: 6pt 10pt; background: #fef3c7; border-left: 3px solid #d97706; font-size: 10pt; color: #92400e; }
  .bw-passage { font-size: 11pt; line-height: 1.85; padding: 10pt 12pt; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
  .bw-blank { display: inline-block; min-width: 60px; border-bottom: 1.5px solid #1f2937; padding: 0 4px; color: transparent; user-select: none; }
  .bw-blank-phrase { border-bottom-style: double; border-bottom-width: 3px; }
  .bw-blank-num { display: inline-block; font-weight: 700; color: #1e3a8a; margin-right: 2px; }
  .bw-blank-hint { display: inline-block; font-size: 9pt; color: #6b7280; margin-left: 3px; }
  .bw-answer-write-block { margin-top: 8pt; padding: 6pt 10pt; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
  .bw-answer-write { display: flex; align-items: flex-start; gap: 8pt; margin: 4pt 0; }
  .bw-answer-write-num { flex-shrink: 0; font-weight: 700; color: #1e3a8a; min-width: 20pt; padding-top: 2pt; }
  .bw-answer-write-lines { flex: 1; }
  .bw-answer-write-lines .bw-write-row { margin-top: 4pt; }
  .bw-answer-write-lines .bw-write-row:first-child { margin-top: 0; }
  .bw-answer-key { margin-top: 18pt; padding-top: 10pt; border-top: 2px solid #1f2937; }
  .bw-answer-key h2 { color: #b91c1c; }
  .bw-answer-source { display: inline-block; margin: 0 0 10pt; padding: 4pt 10pt; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; font-size: 11pt; font-weight: 700; color: #b91c1c; }
  .bw-answer-list { margin: 6pt 0; padding: 8pt 12pt; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 11pt; line-height: 1.9; }
  .bw-answer-list .ans { display: inline-block; margin-right: 14pt; }
  .bw-answer-list .ans .lab { font-weight: 700; color: #b91c1c; margin-right: 3px; }
  .bw-answer-essay { margin-top: 10pt; }
  .bw-answer-essay .row { margin: 4pt 0; padding: 6pt 10pt; background: #fef2f2; border-left: 3px solid #b91c1c; border-radius: 3px; font-size: 11pt; }
  .bw-answer-essay .row .num { font-weight: 700; color: #b91c1c; margin-right: 6px; }
  @media print { .bw-answer-key { page-break-before: always; border-top: none; padding-top: 0; } }
  .bw-lemma { display: inline-block; padding: 0 4px; color: #1e3a8a; background: #eff6ff; border: 1px dashed #93c5fd; border-radius: 3px; font-style: italic; }
  .bw-lemma-empty { color: #b45309; background: #fffbeb; border-color: #d97706; }
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
  .bw-order-q { margin-top: 14pt; padding: 10pt 12pt; border: 1px solid #e5e7eb; border-radius: 6px; }
  .bw-order-q .num { font-weight: 700; margin-right: 6px; }
  .bw-order-list { margin-top: 6pt; padding: 6pt 10pt; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 11pt; }
  .bw-order-list .lab { font-weight: 700; color: #1e3a8a; margin-right: 4px; }
  .bw-order-list .chunk { display: inline-block; padding: 1px 6px; margin: 2px 8px 2px 0; }
  .bw-table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 10.5pt; }
  .bw-table th, .bw-table td { border: 1px solid #d1d5db; padding: 6pt 8pt; text-align: left; vertical-align: top; }
  .bw-table th { background: #f3f4f6; font-weight: 700; }
  .bw-table .kind { color: #6b7280; font-size: 9pt; font-weight: 400; }
  .bw-section { padding-top: 4pt; }
  .bw-section + .bw-section { margin-top: 18pt; padding-top: 14pt; border-top: 1px dashed #d1d5db; }
  @media print { .bw-section + .bw-section { page-break-before: always; border-top: none; margin-top: 0; padding-top: 0; } }
  .bw-section-meta { font-size: 9pt; color: #4b5563; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1px dashed #d1d5db; font-weight: 600; }
`;

const WORD_META = `<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="ProgId" content="Word.Document"><meta name="Generator" content="Microsoft Word"><meta name="Originator" content="Microsoft Word"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`;

function htmlShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${WORD_META}<title>${escapeHtml(title)}</title><style>${SHARED_CSS}</style></head><body>
${body}
</body></html>`;
}

// ── 결정적 셔플 (mulberry32) ──────────────────────────────────────────────────

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 문장의 토큰을 5~8개 청크로 균등 분할. 청크 개수는 단어 수 / 4 를 반올림한 값(최소 5, 최대 8). */
function chunkSentence(tokens: string[]): string[][] {
  const targetChunks = Math.min(8, Math.max(5, Math.round(tokens.length / 4)));
  const baseSize = Math.floor(tokens.length / targetChunks);
  const remainder = tokens.length - baseSize * targetChunks;
  const out: string[][] = [];
  let i = 0;
  for (let c = 0; c < targetChunks; c++) {
    const size = baseSize + (c < remainder ? 1 : 0);
    out.push(tokens.slice(i, i + size));
    i += size;
  }
  return out;
}

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

/** 각 섹션(=각 인쇄 페이지) 상단에 교재·소스 표기 — PDF 두 번째 페이지부터도 정보가 남도록. */
function sectionMeta({ textbook, sourceKey }: BuildOptions): string {
  return `<div class="bw-section-meta">${escapeHtml(textbook)} · ${escapeHtml(sourceKey)}</div>`;
}

function fragmentA(opts: BuildOptions): string {
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
  return `<section class="bw-section bw-section-A">
<h2>A. 단어 빈칸</h2>
<div class="bw-passage">${body}</div>
${bogiHtml}
</section>`;
}

export function buildWordBlankHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 단어 빈칸`, `${header(opts)}
${fragmentA(opts)}`);
}

function fragmentB(opts: BuildOptions): string {
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
  return `<section class="bw-section bw-section-B">
<h2>B. 구·표현 빈칸</h2>
<div class="bw-passage">${body}</div>
${bogiHtml}
</section>`;
}

export function buildPhraseBlankHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 구 빈칸`, `${header(opts)}
${fragmentB(opts)}`);
}

function fragmentC(opts: BuildOptions): string {
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
  return `<section class="bw-section bw-section-C">
<h2>C. 문장 영작</h2>
<div class="bw-passage">${body}</div>
${questionHtml}
</section>`;
}

export function buildSentenceEssayHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 문장 영작`, `${header(opts)}
${fragmentC(opts)}`);
}

// ── D. 어순 배열 ──────────────────────────────────────────────────────────────

function fragmentD(opts: BuildOptions): string {
  const sentenceBlocks = opts.selection.blocks.filter(b => b.kind === 'sentence');
  const passageHtml = opts.selection.sentences
    .map(s => escapeHtml(s.text))
    .join(' ');
  const labels = ['(A)', '(B)', '(C)', '(D)', '(E)', '(F)', '(G)', '(H)'];

  const questionsHtml = sentenceBlocks.length
    ? sentenceBlocks
        .map((b, i) => {
          const sent = opts.selection.sentences.find(s => s.idx === b.sentenceIdx);
          if (!sent) return '';
          const chunks = chunkSentence(sent.tokens);
          const seed = b.sentenceIdx * 1000 + sent.tokens.length * 31 + (sent.tokens[0]?.charCodeAt(0) ?? 0);
          const shuffled = shuffleDeterministic(
            chunks.map((c, idx) => ({ idx, chunk: joinTokens(c) })),
            seed,
          );
          const labeled = shuffled.map((s2, j) => ({ label: labels[j] ?? `(${j + 1})`, chunk: s2.chunk }));
          const correctOrderInShuffled = chunks.map((_, originalIdx) => {
            const newPos = shuffled.findIndex(s2 => s2.idx === originalIdx);
            return labels[newPos] ?? `(${newPos + 1})`;
          });
          return `<div class="bw-order-q">
  <div><span class="num">${i + 1}.</span> 보기의 청크를 올바른 순서로 배열하여 문장을 완성하세요. <span class="bw-meta" style="margin:0">(${labels[0]}~${labels[chunks.length - 1] ?? `(${chunks.length})`} ${chunks.length}개)</span></div>
  <div class="bw-order-list">${labeled.map(l => `<span class="chunk"><span class="lab">${l.label}</span>${escapeHtml(l.chunk)}</span>`).join('')}</div>
  <div class="bw-condition">▸ 정답 순서: <span class="bw-meta" style="margin:0">(예: ${correctOrderInShuffled.join('-')})</span></div>
  <div class="bw-write-row"></div>
</div>`;
        })
        .join('\n')
    : '<div class="bw-meta">선택된 문장 블록이 없습니다.</div>';

  return `<section class="bw-section bw-section-D">
${sectionMeta(opts)}
<h2>D. 어순 배열</h2>
<div class="bw-passage">${passageHtml}</div>
${questionsHtml}
</section>`;
}

export function buildSentenceOrderHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 어순 배열`, `${header(opts)}
${fragmentD(opts)}`);
}

// ── E. 핵심 표현 정리 ─────────────────────────────────────────────────────────

const KIND_LABEL_KO: Record<'word' | 'phrase' | 'sentence', string> = {
  word: '단어',
  phrase: '구',
  sentence: '문장',
};

function fragmentE(opts: BuildOptions): string {
  const sorted = sortBlocks(opts.selection.blocks);
  const rows = sorted
    .map(b => {
      const sent = opts.selection.sentences.find(s => s.idx === b.sentenceIdx);
      if (!sent) return '';
      const english = joinTokens(sent.tokens.slice(b.startTokenIdx, b.endTokenIdx + 1));
      // sentence 블록은 DB 의 sentence.korean 으로 fallback 가능
      const fallback = b.kind === 'sentence' ? (sent.korean ?? '').trim() : '';
      const korean = (b.koreanMeaning ?? '').trim() || fallback;
      const koreanCell = korean
        ? escapeHtml(korean)
        : '<span class="bw-meta" style="margin:0">(미입력)</span>';
      return `<tr>
  <td><div class="kind">${KIND_LABEL_KO[b.kind]}</div>${escapeHtml(english)}</td>
  <td>${koreanCell}</td>
</tr>`;
    })
    .filter(Boolean)
    .join('\n');

  const tableHtml = rows
    ? `<table class="bw-table">
  <thead><tr><th style="width:55%">English</th><th>한국어</th></tr></thead>
  <tbody>
  ${rows}
  </tbody>
</table>`
    : '<div class="bw-meta">선택된 블록이 없습니다.</div>';

  const passageHtml = opts.selection.sentences.map(s => escapeHtml(s.text)).join(' ');

  return `<section class="bw-section bw-section-E">
${sectionMeta(opts)}
<h2>E. 핵심 표현 정리</h2>
<div class="bw-passage">${passageHtml}</div>
${tableHtml}
</section>`;
}

export function buildKeyExpressionHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 핵심 표현 정리`, `${header(opts)}
${fragmentE(opts)}`);
}

// ── F. 어법 변형 ──────────────────────────────────────────────────────────────

function fragmentF(opts: BuildOptions): string {
  const wordBlocks = opts.selection.blocks.filter(b => b.kind === 'word');
  let missingCount = 0;

  const sentenceHtmls = opts.selection.sentences.map(s => {
    const blocksHere = wordBlocks
      .filter(b => b.sentenceIdx === s.idx)
      .sort((a, b) => a.startTokenIdx - b.startTokenIdx);
    if (blocksHere.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const block = blocksHere.find(b => b.startTokenIdx === i);
      if (block) {
        const lemma = (block.baseForm ?? '').trim();
        if (!lemma) missingCount += 1;
        const cls = lemma ? 'bw-lemma' : 'bw-lemma bw-lemma-empty';
        out.push(`(<span class="${cls}">${escapeHtml(lemma || '?')}</span>)`);
        i = block.endTokenIdx + 1;
        continue;
      }
      out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });

  const body = sentenceHtmls.join(' ');
  const warning = missingCount > 0
    ? `<div class="bw-warning">⚠ 단어 블록 ${missingCount}개에 base form 이 입력되지 않아 (?) 로 표시됩니다.</div>`
    : '';

  const writeRowsHtml = wordBlocks.length
    ? wordBlocks
        .map((_, i) => `<div class="bw-condition"><b>${i + 1}.</b></div><div class="bw-write-row"></div>`)
        .join('\n')
    : '<div class="bw-meta">선택된 단어 블록이 없습니다.</div>';

  return `<section class="bw-section bw-section-F">
${sectionMeta(opts)}
<h2>F. 어법 변형</h2>
${warning}
<div class="bw-meta">▸ 괄호 안의 단어를 문맥에 맞게 어형 변환하여 빈칸을 완성하세요.</div>
<div class="bw-passage">${body}</div>
${writeRowsHtml}
</section>`;
}

export function buildGrammarTransformHtml(opts: BuildOptions): string {
  return htmlShell(`${opts.title} — 어법 변형`, `${header(opts)}
${fragmentF(opts)}`);
}

interface UnifiedQuestion {
  html: string;
  heading: string;
  blankAnswers: UnifiedRender['blankAnswers'];
  essayItems: UnifiedRender['essayItems'];
  hasContent: boolean;
}

/** 통합 문제지 페이지 한 장 — showKorean 에 따라 해석 포함/제외. */
function buildUnifiedQuestion(
  opts: BuildOptions,
  types: WorkbookKind[],
  showKorean: boolean,
): UnifiedQuestion {
  const activeKinds = new Set<'word' | 'phrase' | 'sentence'>();
  if (types.includes('A')) activeKinds.add('word');
  if (types.includes('B')) activeKinds.add('phrase');
  if (types.includes('C')) activeKinds.add('sentence');
  if (activeKinds.size === 0) {
    return { html: '', heading: '', blankAnswers: [], essayItems: [], hasContent: false };
  }

  const { body, blankAnswers, essayItems } = renderUnifiedMaskedBody(
    opts.selection.sentences,
    opts.selection.blocks,
    activeKinds,
    showKorean,
  );

  const labels: string[] = [];
  if (activeKinds.has('word')) labels.push('A. 단어');
  if (activeKinds.has('phrase')) labels.push('B. 구');
  if (activeKinds.has('sentence')) labels.push('C. 문장');
  const heading = `통합 빈칸 (${labels.join(' · ')})`;

  const essayPrompts = activeKinds.has('sentence') && essayItems.length
    ? `<div class="bw-essay-block">
<div class="bw-bogi-label" style="color:#92400e;margin-top:14pt;">▸ 문장 영작 — 본문의 [번호] 자리에 들어갈 영어 문장을 작성하세요.</div>
${essayItems
  .map(it => {
    const koreanLine = showKorean
      ? `<div class="bw-condition">▸ 한국어 해석: <span class="ko">${escapeHtml(it.korean || '(미입력)')}</span></div>`
      : '';
    return `<div class="bw-essay-q">
  <div><span class="num">${it.num}.</span> ${showKorean ? '다음 한국어 해석에 부합하도록 영어 문장을 작성하세요.' : '본문의 [' + it.num + '] 자리에 들어갈 영어 문장을 작성하세요.'}</div>
  ${koreanLine}
  <div class="bw-condition">▸ 작성 단어 수: <b>${it.wordCount}개</b></div>
  <div class="bw-write-row"></div>
  <div class="bw-write-row"></div>
</div>`;
  })
  .join('\n')}
</div>`
    : '';

  const headerNote = showKorean
    ? '▸ 본문의 빈칸 ①②③… 에 들어갈 단어·구 를 적고, [번호] 자리에는 영어 문장을 영작하세요.'
    : '▸ 본문의 빈칸 ①②③… 에 들어갈 단어·구 를 적으세요. (한국어 해석 없이)';

  const writeRowsHtml = blankAnswers.length
    ? `<div class="bw-answer-write-block">
<div class="bw-bogi-label" style="color:#1e3a8a;margin-top:14pt;">▸ 단어·구 정답 작성란</div>
${blankAnswers
  .map(a => `<div class="bw-answer-write">
  <div class="bw-answer-write-num">${escapeHtml(a.label)}</div>
  <div class="bw-answer-write-lines">
    <div class="bw-write-row"></div>
    <div class="bw-write-row"></div>
  </div>
</div>`)
  .join('\n')}
</div>`
    : '';

  const html = `<section class="bw-section bw-section-unified">
${sectionMeta(opts)}
<h2>${escapeHtml(heading)}${showKorean ? ' — 해석 포함' : ' — 해석 제외'}</h2>
<div class="bw-meta">${headerNote}</div>
<div class="bw-passage">${body}</div>
${writeRowsHtml}
${essayPrompts}
</section>`;

  return { html, heading, blankAnswers, essayItems, hasContent: true };
}

/** 통합 답지 페이지 한 장 — 양쪽 버전 정답이 동일하므로 한 번만 출력. */
function buildUnifiedAnswer(q: UnifiedQuestion, opts: BuildOptions): string {
  if (!q.hasContent) return '';
  if (!q.blankAnswers.length && !q.essayItems.length) return '';

  const blanksHtml = q.blankAnswers.length
    ? `<div class="bw-bogi-label" style="color:#b91c1c;">▸ 단어·구 정답 (출현 순)</div>
<div class="bw-answer-list">${q.blankAnswers
  .map(a => `<span class="ans"><span class="lab">${escapeHtml(a.label)}</span>${escapeHtml(a.original)}</span>`)
  .join('')}</div>`
    : '';

  const essayAnswersHtml = q.essayItems.length
    ? `<div class="bw-answer-essay">
<div class="bw-bogi-label" style="color:#b91c1c;">▸ 문장 영작 정답 (원문)</div>
${q.essayItems
  .map(it => `<div class="row"><span class="num">${it.num}.</span>${escapeHtml(it.english)}</div>`)
  .join('\n')}
</div>`
    : '';

  return `<section class="bw-answer-key">
${sectionMeta(opts)}
<h2>▣ 정답 — ${escapeHtml(q.heading)}</h2>
<div class="bw-answer-source">${escapeHtml(opts.textbook)} · ${escapeHtml(opts.sourceKey)} · ${escapeHtml(opts.title)}</div>
${blanksHtml}
${essayAnswersHtml}
</section>`;
}

/**
 * 통합 페이지 빌더 — 3장 + 보조 섹션.
 * - 1쪽: A/B/C 통합 빈칸 (해석 포함)
 * - 2쪽: A/B/C 통합 빈칸 (해석 제외) — page-break-before
 * - 3쪽: 정답 (양쪽 공통) — page-break-before
 * - 이후 D/E/F 가 활성이면 추가 섹션 (각각 page-break)
 */
export function buildCombinedHtml(
  opts: BuildOptions,
  types: WorkbookKind[],
): string {
  const sections: string[] = [];
  const unifiedActive = types.includes('A') || types.includes('B') || types.includes('C');
  if (unifiedActive) {
    const qWith = buildUnifiedQuestion(opts, types, true);
    const qNo = buildUnifiedQuestion(opts, types, false);
    if (qWith.html) sections.push(qWith.html);
    if (qNo.html) sections.push(qNo.html);
    const ans = buildUnifiedAnswer(qWith, opts);
    if (ans) sections.push(ans);
  }
  if (types.includes('D')) sections.push(fragmentD(opts));
  if (types.includes('E')) sections.push(fragmentE(opts));
  if (types.includes('F')) sections.push(fragmentF(opts));

  const body = sections.length > 0
    ? sections.join('\n')
    : '<div class="bw-meta">선택된 유형이 없습니다.</div>';
  return htmlShell(`${opts.title} — 통합`, `${header(opts)}\n${body}`);
}

export interface FolderWorkbookEntry {
  opts: BuildOptions;
  types: WorkbookKind[];
}

/**
 * 폴더 단위 묶음 PDF 빌더 — 워크북별 문제지(해석 포함 → 해석 제외)를 먼저 모두 출력한 뒤,
 * 모든 워크북의 정답 페이지를 맨 뒤에 한 번에 모아서 출력. 인쇄 시 각 섹션 = 1쪽.
 */
export function buildFolderHtml(folderName: string, entries: FolderWorkbookEntry[]): string {
  const questions: string[] = [];
  const answers: string[] = [];

  for (const e of entries) {
    const types = e.types;
    const unifiedActive = types.includes('A') || types.includes('B') || types.includes('C');
    if (!unifiedActive) continue;
    const qWith = buildUnifiedQuestion(e.opts, types, true);
    const qNo = buildUnifiedQuestion(e.opts, types, false);
    if (qWith.html) questions.push(qWith.html);
    if (qNo.html) questions.push(qNo.html);
    const a = buildUnifiedAnswer(qWith, e.opts);
    if (a) answers.push(a);
  }

  const body = questions.length === 0 && answers.length === 0
    ? '<div class="bw-meta">출력할 워크북이 없습니다.</div>'
    : `${questions.join('\n')}\n${answers.join('\n')}`;

  return htmlShell(`폴더 ${folderName} — 통합 PDF`, body);
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
  if (types.includes('D')) out.D = buildSentenceOrderHtml(opts);
  if (types.includes('E')) out.E = buildKeyExpressionHtml(opts);
  if (types.includes('F')) out.F = buildGrammarTransformHtml(opts);
  return out;
}
