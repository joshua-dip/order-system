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
  DEFAULT_CONNECTOR_POOL,
  SelectionBlock,
  SentenceTokenized,
  WorkbookKind,
  blockUseIncludes,
  sentenceUsesIncludes,
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

/**
 * 단어/구 블록만 받아 본문 마스킹 + 보기 목록 추출.
 * kindFilter=['word'] 면 A 용 — uses 에 'A' 가 포함된 word 블록만.
 * kindFilter=['phrase'] 면 B 용 — uses 에 'B' 가 포함된 phrase 블록만.
 */
function renderMaskedBody(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
  kindFilter: ('word' | 'phrase')[],
): MaskedRender {
  const useFor = (k: 'word' | 'phrase'): 'A' | 'B' => (k === 'word' ? 'A' : 'B');
  const filtered = blocks.filter(b => {
    if (b.kind !== 'word' && b.kind !== 'phrase') return false;
    if (!(kindFilter as string[]).includes(b.kind)) return false;
    return blockUseIncludes(b, useFor(b.kind));
  });
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
  // C 영작용으로 표기된 sentence 블록만 (uses 미설정 = 백워드 호환으로 포함)
  const sentenceBlocks = blocks.filter(b => sentenceUsesIncludes(b, 'C'));
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
  /**
   * 빈칸 정답 목록 (출현 순 — ①②③… 와 1:1).
   * baseForm 이 있으면 F 결합 모드에서 본문에 (base form) 힌트가 같이 노출된 빈칸.
   */
  blankAnswers: {
    label: string;
    kind: 'word' | 'phrase';
    original: string;
    baseForm?: string;
  }[];
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
 * - includeGrammar=true 면 word 빈칸 옆에 (baseForm) 괄호를 같이 노출해 F(어법 변형) 를 결합.
 *   A 가 활성일 때만 의미가 있다. F 단독은 fragmentF 가 별도 섹션으로 처리.
 */
function renderUnifiedMaskedBody(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
  activeKinds: ReadonlySet<'word' | 'phrase' | 'sentence'>,
  showKorean: boolean,
  includeGrammar: boolean = false,
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
    // 각 kind 별로 해당 use(A/B/C) 가 켜진 블록만 통합 본문에 노출.
    const here = blocks.filter(b => {
      if (b.sentenceIdx !== s.idx) return false;
      if (!activeKinds.has(b.kind)) return false;
      if (b.kind === 'word') return blockUseIncludes(b, 'A');
      if (b.kind === 'phrase') return blockUseIncludes(b, 'B');
      return blockUseIncludes(b, 'C'); // sentence
    });
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
        // F 결합 — word 블록이고 F 활성이며 그 블록 자체가 F use 를 켰을 때만.
        const grammarOn = kind === 'word' && includeGrammar && blockUseIncludes(block, 'F');
        const baseForm = grammarOn ? (block.baseForm ?? '').trim() : '';
        blankAnswers.push({
          label,
          kind,
          original: phrase,
          ...(baseForm ? { baseForm } : {}),
        });
        const cls = kind === 'phrase' ? 'bw-blank bw-blank-phrase' : 'bw-blank bw-blank-word';
        const tokenCount = block.endTokenIdx - block.startTokenIdx + 1;
        const phraseKorean = kind === 'phrase' && showKorean ? (block.koreanMeaning ?? '').trim() : '';
        const phraseHint = kind === 'phrase'
          ? phraseKorean
            ? ` <span class="bw-blank-hint">(${tokenCount}단어 · ${escapeHtml(phraseKorean)})</span>`
            : ` <span class="bw-blank-hint">(${tokenCount}단어)</span>`
          : '';
        const grammarHint = grammarOn
          ? baseForm
            ? ` <span class="bw-lemma">(${escapeHtml(baseForm)})</span>`
            : ` <span class="bw-lemma bw-lemma-empty">(?)</span>`
          : '';
        out.push(`<span class="bw-blank-num">${escapeHtml(label)}</span><span class="${cls}">${escapeHtml(blankFor(phrase))}</span>${phraseHint}${grammarHint}`);
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
  /* === A4 인쇄 시 색상 보존 === */
  .bw-section-head, .bw-section-head .bw-tag,
  .bw-answer-header, .bw-answer-source, .bw-answer-list, .bw-answer-essay .row,
  .bw-bogi, .bw-passage, .bw-table th, .bw-warning, .bw-korean, .bw-lemma,
  .bw-essay-q .ko, .bw-order-list,
  .bw-connector-options, .bw-connector-q {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  body {
    font-family: 'Noto Serif CJK KR', 'Noto Serif KR', 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #111;
    margin: 0 auto;
    padding: 16pt 22pt 14pt;
    max-width: 800px;
    background: #fff;
  }

  /* === 시험지 상단 헤더 === */
  .bw-header {
    border-bottom: 2pt solid #111;
    padding-bottom: 6pt;
    margin-bottom: 10pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-header .bw-h-title {
    font-size: 16pt;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.5pt;
  }
  .bw-header .bw-h-meta {
    font-size: 9.5pt;
    color: #555;
    margin-top: 3pt;
  }

  /* === 섹션 헤더 (검은 바 + 흰 태그) === */
  .bw-section { margin-top: 10pt; }
  .bw-section-head {
    background: #111;
    color: #fff;
    padding: 4pt 10pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 11pt;
    font-weight: 600;
    margin: 0 0 6pt 0;
    letter-spacing: -0.3pt;
  }
  .bw-section-head .bw-tag {
    background: #fff;
    color: #111;
    padding: 1pt 5pt;
    border-radius: 2pt;
    font-size: 8.5pt;
    margin-right: 7pt;
    font-weight: 700;
  }
  .bw-section-meta {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 8.5pt;
    color: #666;
    margin: 0 0 4pt 0;
    font-weight: 600;
  }
  .bw-instruction {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9.5pt;
    color: #444;
    margin: 0 0 5pt 0;
  }
  .bw-meta {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
    color: #555;
  }
  /* 인쇄/PDF 호환 — 옛 호출에서 h1/h2 가 남아 있어도 스타일 유지 */
  h1 { font-family: 'Noto Sans CJK KR', sans-serif; font-size: 16pt; margin: 0 0 4pt; }
  h2 { font-family: 'Noto Sans CJK KR', sans-serif; font-size: 11pt; margin: 10pt 0 5pt; padding: 4pt 10pt; background: #111; color: #fff; }

  /* === 본문 (지문) === */
  .bw-passage {
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 10.5pt;
    line-height: 1.7;
    text-align: justify;
    padding: 8pt 12pt;
    border: 0.7pt solid #999;
    background: #fafafa;
  }

  /* === 빈칸 === */
  .bw-blank {
    display: inline-block;
    min-width: 56px;
    border-bottom: 1pt solid #111;
    padding: 0 4px;
    color: transparent;
    user-select: none;
  }
  .bw-blank-phrase { border-bottom-style: double; border-bottom-width: 2pt; }
  .bw-blank-num {
    display: inline-block;
    font-weight: 700;
    color: #111;
    margin-right: 2px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-blank-hint {
    display: inline-block;
    font-size: 8.5pt;
    color: #777;
    margin-left: 3px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }

  /* === 한국어 치환 (C/통합) === */
  .bw-korean {
    color: #111;
    background: #fff3d4;
    border: 0.4pt dashed #d97706;
    padding: 1pt 5pt;
    border-radius: 2pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 600;
  }
  .bw-korean-empty { color: #b45309; background: #fffbeb; }

  /* === base form 괄호 (F 결합) === */
  .bw-lemma {
    display: inline-block;
    padding: 0 4px;
    color: #1e3a8a;
    background: #eef4ff;
    border: 0.4pt dashed #6f8fc4;
    border-radius: 2pt;
    font-style: italic;
  }
  .bw-lemma-empty { color: #b45309; background: #fffbeb; border-color: #d97706; }

  /* === 보기 박스 === */
  .bw-bogi {
    margin-top: 8pt;
    padding: 6pt 10pt;
    border: 0.6pt solid #999;
    background: #f5f5f5;
  }
  .bw-bogi-label {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 700;
    color: #111;
    margin-bottom: 3pt;
    font-size: 9.5pt;
  }
  .bw-bogi-list { font-family: 'Times New Roman', serif; font-size: 10.5pt; }
  .bw-bogi-list .item {
    display: inline-block;
    padding: 1pt 6pt;
    margin: 1pt 4pt 1pt 0;
    background: #fff;
    border: 0.5pt solid #888;
    border-radius: 2pt;
  }

  /* === 단어·구 정답 작성란 === */
  .bw-answer-write-block {
    margin-top: 6pt;
    padding: 5pt 8pt;
    border: 0.5pt solid #999;
    background: #fafafa;
  }
  .bw-answer-write { display: flex; align-items: flex-start; gap: 6pt; margin: 3pt 0; }
  .bw-answer-write-num {
    flex-shrink: 0;
    font-weight: 700;
    color: #111;
    min-width: 18pt;
    padding-top: 1pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-answer-write-lines { flex: 1; }
  .bw-write-row {
    border-bottom: 0.5pt solid #555;
    height: 13pt;
    margin-top: 4pt;
  }
  .bw-write-row:first-child { margin-top: 0; }

  /* === C 영작 문항 === */
  .bw-essay-q {
    margin-top: 8pt;
    padding: 6pt 10pt;
    border: 0.6pt solid #888;
    background: #fff;
  }
  .bw-essay-q .num {
    font-weight: 700;
    margin-right: 6px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-essay-q .ko {
    background: #fff3d4;
    padding: 1pt 5pt;
    border-radius: 2pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-condition {
    margin-top: 4pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9.3pt;
    color: #444;
  }

  /* === D 어순배열 문항 === */
  .bw-order-q {
    margin-top: 8pt;
    padding: 6pt 10pt;
    border: 0.6pt solid #888;
  }
  .bw-order-q .num {
    font-weight: 700;
    margin-right: 6px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-order-list {
    margin-top: 4pt;
    padding: 5pt 8pt;
    background: #f5f5f5;
    border: 0.4pt solid #ccc;
    font-family: 'Times New Roman', serif;
    font-size: 10pt;
  }
  .bw-order-list .lab {
    font-weight: 700;
    color: #1e3a8a;
    margin-right: 4px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-order-list .chunk { display: inline-block; padding: 1px 6px; margin: 2px 6px 2px 0; }

  /* === E 표 === */
  .bw-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9.5pt;
  }
  .bw-table th, .bw-table td {
    border: 0.5pt solid #888;
    padding: 4pt 7pt;
    text-align: left;
    vertical-align: top;
  }
  .bw-table th { background: #eee; font-weight: 700; color: #111; }
  .bw-table .kind {
    color: #777;
    font-size: 8pt;
    font-weight: 400;
    margin-bottom: 1pt;
  }

  /* === 정답지 === */
  .bw-answer-key { margin-top: 14pt; }
  .bw-answer-header {
    background: #b91c1c;
    color: #fff;
    padding: 4pt 10pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    margin: 0 0 5pt 0;
    font-size: 12pt;
    font-weight: 700;
  }
  .bw-answer-source {
    display: inline-block;
    margin: 2pt 0 6pt;
    padding: 2pt 7pt;
    background: #fef2f2;
    border: 0.5pt solid #fca5a5;
    border-radius: 2pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9.5pt;
    font-weight: 700;
    color: #b91c1c;
  }
  .bw-answer-list {
    margin: 4pt 0;
    padding: 5pt 8pt;
    background: #fef2f2;
    border-left: 2.5pt solid #b91c1c;
    font-family: 'Times New Roman', serif;
    font-size: 10pt;
    line-height: 1.7;
  }
  .bw-answer-list .ans { display: inline-block; margin-right: 12pt; }
  .bw-answer-list .ans .lab {
    font-weight: 700;
    color: #b91c1c;
    margin-right: 3px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-answer-essay { margin-top: 6pt; }
  .bw-answer-essay .row {
    margin: 3pt 0;
    padding: 4pt 8pt;
    background: #fef2f2;
    border-left: 2.5pt solid #b91c1c;
    font-family: 'Times New Roman', serif;
    font-size: 10pt;
  }
  .bw-answer-essay .row .num {
    font-weight: 700;
    color: #b91c1c;
    margin-right: 6px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }

  /* === 문항 카드 공통 헤더 === */
  .bw-essay-q-head {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 10pt;
    font-weight: 600;
    color: #111;
    margin: 0 0 4pt;
  }
  .bw-essay-q-head .num { margin-right: 6px; }

  /* === I 접속사 빈칸 === */
  .bw-blank-connector {
    display: inline-block;
    min-width: 90px;
    border-bottom: 1.4pt solid #111;
    padding: 0 6px;
    color: transparent;
    font-weight: 700;
  }
  .bw-connector-q {
    margin-top: 8pt;
    padding: 6pt 10pt;
    border: 0.6pt solid #888;
    background: #fff;
  }
  .bw-connector-q .num {
    font-weight: 700;
    margin-right: 6px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .bw-connector-options {
    margin-top: 4pt;
    padding: 5pt 10pt;
    background: #f5f5f5;
    border: 0.4pt solid #ccc;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 10pt;
    line-height: 1.7;
  }
  .bw-connector-options .opt {
    display: inline-block;
    padding: 1pt 8pt;
    margin: 1pt 10pt 1pt 0;
  }
  .bw-connector-options .opt b {
    color: #1e3a8a;
    font-weight: 700;
    margin-right: 3px;
  }

  /* === 경고 === */
  .bw-warning {
    margin: 6pt 0;
    padding: 4pt 8pt;
    background: #fef3c7;
    border-left: 2.5pt solid #d97706;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
    color: #92400e;
  }

  /* === 섹션 구분 (preview) === */
  .bw-section + .bw-section {
    margin-top: 14pt;
    padding-top: 10pt;
    border-top: 1pt dashed #ccc;
  }

  @page { size: A4; margin: 13mm 14mm 12mm 14mm; }

  @media print {
    body { padding: 0; max-width: none; }
    .bw-section + .bw-section {
      page-break-before: always;
      border-top: none;
      margin-top: 0;
      padding-top: 0;
    }
    .bw-section + .bw-answer-key { page-break-before: always; padding-top: 0; }
    .bw-answer-key + .bw-answer-key { page-break-before: avoid; }
  }
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
  // sourceKey 가 textbook 으로 시작하면 prefix 를 떼어 중복 표기 방지
  const tb = (textbook || '').trim();
  let sk = (sourceKey || '').trim();
  if (tb && sk.startsWith(tb)) sk = sk.slice(tb.length).trim();
  const metaParts = [tb, sk].filter(Boolean);
  return `<header class="bw-header">
  <div class="bw-h-title">${escapeHtml(title)}</div>
  <div class="bw-h-meta">${escapeHtml(metaParts.join(' · '))}</div>
</header>`;
}

/** 섹션 헤더 — 검은 바 + 흰 태그(A~F) + 제목. */
function sectionHead(tag: string, label: string): string {
  return `<div class="bw-section-head"><span class="bw-tag">${escapeHtml(tag)}</span>${escapeHtml(label)}</div>`;
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
${sectionHead('A', '단어 빈칸')}
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
${sectionHead('B', '구·표현 빈칸')}
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
${sectionHead('C', '문장 영작')}
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
  // D 어순 배열용으로 표기된 sentence 블록만 (uses 미설정 = 백워드 호환으로 포함)
  const sentenceBlocks = opts.selection.blocks.filter(b => sentenceUsesIncludes(b, 'D'));
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
${sectionHead('D', '어순 배열')}
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
  // E 표 정리용으로 표기된 블록만 (uses 미설정 = 백워드 호환으로 모든 적격 use 포함)
  const sorted = sortBlocks(opts.selection.blocks.filter(b => blockUseIncludes(b, 'E')));
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
${sectionHead('E', '핵심 표현 정리')}
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
  // F 어법 변형 — block-workbook-types 가 F 를 deprecated 처리해 blockUseIncludes 가 항상 false.
  // 본 렌더러는 「어법공략 워크북」 전용이므로 직접 필터:
  //   uses 미설정/빈 배열 → 백워드 호환으로 포함
  //   uses 설정 → 'F' 가 명시돼 있을 때만
  const wordBlocks = opts.selection.blocks.filter(b => {
    if (b.kind !== 'word') return false;
    if (!b.uses || b.uses.length === 0) return true;
    return b.uses.includes('F');
  });
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
${sectionHead('F', '어법 변형')}
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

// ── I. 접속사·접속부사 빈칸 ────────────────────────────────────────────────────
//
// 변형문제 「빈칸 추론(접속어)」. word/phrase 블록(use='I') 자리를 [Q1] ____ 로 마스킹.
// 각 블록당 한 카드: 정답 + distractor 4개 = 5지선다. 정답 위치는 결정적 셔플.
// distractor 가 비어 있거나 4개 미만이면 DEFAULT_CONNECTOR_POOL 에서 자동 채움.

interface IItem {
  num: number;            // Q1, Q2, ...
  blockLabel: string;     // 본문 마스킹에 표시되는 라벨 (예: "Q1")
  original: string;       // 정답 원문 (블록 토큰 합)
  options: string[];      // 5개 옵션 (셔플 적용된 순서)
  answerOptionIdx: number; // 1-base — options 안에서 정답 위치
  sentenceIdx: number;
  startTokenIdx: number;
}

/** distractor 4개 채움 — 사용자 입력 + 부족분은 DEFAULT_CONNECTOR_POOL 에서 결정적 셔플로. */
function fillConnectorOptions(
  block: SelectionBlock,
  answer: string,
  seed: number,
): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set<string>([norm(answer)]);
  const userPool: string[] = [];
  for (const raw of block.distractors ?? []) {
    const s = (raw ?? '').trim();
    if (!s) continue;
    const k = norm(s);
    if (taken.has(k)) continue;
    taken.add(k);
    userPool.push(s);
    if (userPool.length >= 4) break;
  }
  const need = 4 - userPool.length;
  if (need <= 0) return userPool;

  const candidates = DEFAULT_CONNECTOR_POOL.filter(c => !taken.has(norm(c)));
  const picked = shuffleDeterministic(candidates, seed).slice(0, need);
  return [...userPool, ...picked];
}

function fragmentI(opts: BuildOptions): { html: string; items: IItem[] } {
  const iBlocks = sortBlocks(
    opts.selection.blocks.filter(
      b => (b.kind === 'word' || b.kind === 'phrase') && blockUseIncludes(b, 'I'),
    ),
  );

  if (iBlocks.length === 0) {
    return {
      html: `<section class="bw-section bw-section-I">
${sectionHead('I', '접속사·접속부사 빈칸')}
<div class="bw-meta">I 용도(use=I) 로 표기된 word/phrase 블록이 없습니다.</div>
</section>`,
      items: [],
    };
  }

  const items: IItem[] = [];
  iBlocks.forEach((b, idx) => {
    const sent = opts.selection.sentences.find(s => s.idx === b.sentenceIdx);
    if (!sent) return;
    const phrase = joinTokens(sent.tokens.slice(b.startTokenIdx, b.endTokenIdx + 1));
    const num = idx + 1;
    const blockLabel = `Q${num}`;
    const seed = b.sentenceIdx * 1000 + b.startTokenIdx * 31 + (phrase.charCodeAt(0) || 0);
    const distractors = fillConnectorOptions(b, phrase, seed);
    const all = [phrase, ...distractors];
    const shuffled = shuffleDeterministic(all, seed + 7);
    const answerOptionIdx = shuffled.findIndex(s => s === phrase) + 1; // 1-base
    items.push({ num, blockLabel, original: phrase, options: shuffled, answerOptionIdx, sentenceIdx: b.sentenceIdx, startTokenIdx: b.startTokenIdx });
  });

  // 본문 마스킹 — I-블록 자리만 [Q1] ____ 로 치환
  const sentenceHtmls = opts.selection.sentences.map(s => {
    const blocksHere = iBlocks
      .filter(b => b.sentenceIdx === s.idx)
      .sort((a, b) => a.startTokenIdx - b.startTokenIdx);
    if (blocksHere.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const block = blocksHere.find(bb => bb.startTokenIdx === i);
      if (block) {
        const phrase = joinTokens(s.tokens.slice(block.startTokenIdx, block.endTokenIdx + 1));
        const item = items.find(it => it.sentenceIdx === block.sentenceIdx && it.startTokenIdx === block.startTokenIdx);
        const lbl = item?.blockLabel ?? '?';
        out.push(`<span class="bw-blank-num">${escapeHtml(lbl)}</span><span class="bw-blank bw-blank-connector">${escapeHtml(blankFor(phrase))}</span>`);
        i = block.endTokenIdx + 1;
        continue;
      }
      const inMid = blocksHere.some(bb => i > bb.startTokenIdx && i <= bb.endTokenIdx);
      if (!inMid) out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });
  const body = sentenceHtmls.join(' ');

  const cardsHtml = items
    .map(it => `<div class="bw-connector-q">
  <div class="bw-essay-q-head"><span class="num">${escapeHtml(it.blockLabel)}.</span> 위 본문의 <b>[${escapeHtml(it.blockLabel)}]</b> 자리에 들어갈 말로 가장 적절한 것은?</div>
  <div class="bw-connector-options">${it.options.map((o, i) => `<span class="opt"><b>${escapeHtml(blankLabel(i + 1))}</b> ${escapeHtml(o)}</span>`).join('')}</div>
</div>`)
    .join('\n');

  const html = `<section class="bw-section bw-section-I">
${sectionHead('I', '접속사·접속부사 빈칸')}
<div class="bw-instruction">▸ 본문의 [Q1], [Q2]… 자리에 들어갈 말로 가장 적절한 것을 5지선다에서 고르세요.</div>
<div class="bw-passage">${body}</div>
${cardsHtml}
</section>`;

  return { html, items };
}

function buildConnectorAnswer(items: IItem[], opts: BuildOptions): string {
  if (items.length === 0) return '';
  const list = items
    .map(it => `<span class="ans"><span class="lab">${escapeHtml(it.blockLabel)}.</span>${escapeHtml(blankLabel(it.answerOptionIdx))} ${escapeHtml(it.original)}</span>`)
    .join('');
  return `<section class="bw-answer-key">
<div class="bw-answer-header">▣ 정답 — I. 접속사·접속부사 빈칸</div>
<div class="bw-answer-list">${list}</div>
</section>`;
  // opts 미사용이지만 시그니처 일관성 유지용
  void opts;
}

export function buildConnectorBlankHtml(opts: BuildOptions): string {
  const { html } = fragmentI(opts);
  return htmlShell(`${opts.title} — 접속사·접속부사 빈칸`, `${header(opts)}
${html}`);
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

  // F (어법 변형) 가 활성이고 A 도 활성이면, 단어 빈칸에 (baseForm) 괄호를 같이 노출해 결합.
  const includeGrammar = types.includes('F') && activeKinds.has('word');

  const { body, blankAnswers, essayItems } = renderUnifiedMaskedBody(
    opts.selection.sentences,
    opts.selection.blocks,
    activeKinds,
    showKorean,
    includeGrammar,
  );

  const labels: string[] = [];
  if (activeKinds.has('word')) labels.push(includeGrammar ? 'A. 단어 + F. 어법' : 'A. 단어');
  if (activeKinds.has('phrase')) labels.push('B. 구');
  if (activeKinds.has('sentence')) labels.push('C. 문장');
  if (types.includes('D')) labels.push('D. 어순');
  if (types.includes('E')) labels.push('E. 표현');
  if (types.includes('F') && !includeGrammar) labels.push('F. 어법');
  const heading = `통합 (${labels.join(' · ')})`;

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

  const headerParts: string[] = [];
  headerParts.push(
    includeGrammar
      ? '▸ 본문의 빈칸 ①②③… 에 들어갈 단어·구 를 적고, 단어 빈칸은 옆 괄호 안 어형을 문맥에 맞게 변환하세요.'
      : '▸ 본문의 빈칸 ①②③… 에 들어갈 단어·구 를 적으세요.',
  );
  if (activeKinds.has('sentence')) {
    headerParts.push(showKorean ? '[번호] 자리에는 영어 문장을 영작하세요.' : '[번호] 자리에도 영어 문장을 영작하세요.');
  }
  if (!showKorean) headerParts.push('(한국어 해석 없이)');
  const headerNote = headerParts.join(' ');

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
${sectionHead('통합', `${heading.replace(/^통합\s*/, '')}${showKorean ? ' — 해석 포함' : ' — 해석 제외'}`)}
<div class="bw-instruction">${headerNote}</div>
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
  .map(a => {
    const lemma = a.baseForm
      ? ` <span class="bw-meta" style="margin:0;color:#6b7280">(← ${escapeHtml(a.baseForm)})</span>`
      : '';
    return `<span class="ans"><span class="lab">${escapeHtml(a.label)}</span>${escapeHtml(a.original)}${lemma}</span>`;
  })
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
<div class="bw-answer-header">▣ 정답 — ${escapeHtml(q.heading)}</div>
${blanksHtml}
${essayAnswersHtml}
</section>`;
}

/**
 * 통합 페이지 빌더 — A/B/C/D/I 변형문제 워크북.
 *
 * 흐름:
 *   1쪽: A/B/C 통합 본문 (해석 포함)
 *   2쪽: A/B/C 통합 본문 (해석 제외)
 *   3쪽: I 접속사 빈칸 (활성 시)
 *   4쪽: D 어순배열 (활성 시)
 *   5쪽: 통합 정답 (A·B·C 단어·구·문장)
 *   6쪽: I 정답 (활성 시)
 *
 * 옛 'E','F' 는 무시 (E 제거 / F 는 별도 「어법공략 워크북」 탭).
 */
export function buildCombinedHtml(
  opts: BuildOptions,
  types: WorkbookKind[],
): string {
  const sections: string[] = [];
  const unifiedActive = types.includes('A') || types.includes('B') || types.includes('C');
  let unifiedAnswer = '';
  let iAnswerHtml = '';
  if (unifiedActive) {
    const qWith = buildUnifiedQuestion(opts, types, true);
    const qNo = buildUnifiedQuestion(opts, types, false);
    if (qWith.html) sections.push(qWith.html);
    if (qNo.html) sections.push(qNo.html);
    unifiedAnswer = buildUnifiedAnswer(qWith, opts);
  }
  if (types.includes('I')) {
    const iSect = fragmentI(opts);
    sections.push(iSect.html);
    iAnswerHtml = buildConnectorAnswer(iSect.items, opts);
  }
  if (types.includes('D')) sections.push(fragmentD(opts));
  if (unifiedAnswer) sections.push(unifiedAnswer);
  if (iAnswerHtml) sections.push(iAnswerHtml);

  const body = sections.length > 0
    ? sections.join('\n')
    : '<div class="bw-meta">선택된 유형이 없습니다.</div>';
  return htmlShell(`${opts.title} — 통합`, `${header(opts)}\n${body}`);
}

/** 통합 PDF 가 출력할 페이지 수(섹션 수) — 활성 유형으로 추정. UI 라벨 동기화용. */
export function estimateCombinedPageCount(types: WorkbookKind[]): number {
  let n = 0;
  const unified = types.includes('A') || types.includes('B') || types.includes('C');
  if (unified) n += 2; // 해석 포함 + 해석 제외
  if (types.includes('I')) n += 1;
  if (types.includes('D')) n += 1;
  if (unified) n += 1; // 통합 정답
  if (types.includes('I')) n += 1; // I 정답
  return n;
}

export interface FolderWorkbookEntry {
  opts: BuildOptions;
  types: WorkbookKind[];
}

export type FolderPdfMode = 'both' | 'with-ko' | 'no-ko';

/**
 * 폴더 단위 묶음 PDF 빌더.
 * - mode='both' (기본): 워크북별 [해석 포함 → 해석 제외] 문제지 → 마지막에 모든 답지
 * - mode='with-ko': 한국어 해석 포함 문제지만 모음 → 답지
 * - mode='no-ko': 한국어 해석 제외 문제지만 모음 → 답지
 */
export function buildFolderHtml(
  folderName: string,
  entries: FolderWorkbookEntry[],
  mode: FolderPdfMode = 'both',
): string {
  const questions: string[] = [];
  const answers: string[] = [];

  for (const e of entries) {
    const types = e.types;
    const unifiedActive = types.includes('A') || types.includes('B') || types.includes('C');
    const iActive = types.includes('I');
    if (!unifiedActive && !iActive) continue;
    if (unifiedActive) {
      const qWith = buildUnifiedQuestion(e.opts, types, true);
      const qNo = buildUnifiedQuestion(e.opts, types, false);
      if (mode === 'both') {
        if (qWith.html) questions.push(qWith.html);
        if (qNo.html) questions.push(qNo.html);
      } else if (mode === 'with-ko') {
        if (qWith.html) questions.push(qWith.html);
      } else {
        if (qNo.html) questions.push(qNo.html);
      }
      const a = buildUnifiedAnswer(qWith, e.opts);
      if (a) answers.push(a);
    }
    if (iActive) {
      const iSect = fragmentI(e.opts);
      if (iSect.items.length) {
        questions.push(iSect.html);
        const ia = buildConnectorAnswer(iSect.items, e.opts);
        if (ia) answers.push(ia);
      }
    }
  }

  const body = questions.length === 0 && answers.length === 0
    ? '<div class="bw-meta">출력할 워크북이 없습니다.</div>'
    : `${questions.join('\n')}\n${answers.join('\n')}`;

  const titleSuffix = mode === 'with-ko' ? ' (해석 포함)' : mode === 'no-ko' ? ' (해석 제외)' : '';
  return htmlShell(`폴더 ${folderName} — 통합 PDF${titleSuffix}`, body);
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
  if (types.includes('I')) out.I = buildConnectorBlankHtml(opts);
  return out;
}
