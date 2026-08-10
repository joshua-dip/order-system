/**
 * 국어 해설지 서버 렌더러 — Block[] → HTML 문자열.
 *
 * type → 렌더러 함수 한 줄 디스패치. 갈래(genre) 분기 금지.
 * sanitize 는 *_html 필드에 대해서만 적용 (label/title 등 평문은 escapeText).
 *
 * 사용처:
 *   - CLI dry-run/save 시 검증용 HTML 생성
 *   - 새 창 인쇄 페이지의 본문 HTML 조립 (essay-generator 패턴)
 *
 * React 미리보기는 같은 데이터로 [./blocks/](./blocks/) 안의 컴포넌트가 처리한다.
 */

import {
  Block,
  CoverData,
  SectionHeaderData,
  InfoBoxData,
  ParagraphTableData,
  TimelineData,
  CharacterGridData,
  Compare2ColData,
  ConceptGridData,
  ProcessDiagramData,
  EmotionFlowData,
  SijoBoxData,
  GistBoxData,
  QuestionData,
  KoreanExplanation,
} from './types';
import { sanitizeInlineHtml, escapeText } from './sanitize';

// ── 마스터 디스패처 ────────────────────────────────────────────────────────────

const RENDERERS: { [K in Block['type']]: (data: Extract<Block, { type: K }>['data']) => string } = {
  cover:           renderCover,
  section_header:  renderSectionHeader,
  info_box:        renderInfoBox,
  paragraph_table: renderParagraphTable,
  timeline:        renderTimeline,
  character_grid:  renderCharacterGrid,
  compare_2col:    renderCompare2Col,
  concept_grid:    renderConceptGrid,
  process_diagram: renderProcessDiagram,
  emotion_flow:    renderEmotionFlow,
  sijo_box:        renderSijoBox,
  gist_box:        renderGistBox,
  question:        renderQuestion,
};

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join('\n');
}

export function renderBlock(block: Block): string {
  const fn = RENDERERS[block.type] as (data: unknown) => string;
  if (!fn) throw new Error(`unknown block type: ${(block as { type: string }).type}`);
  return fn(block.data);
}

/** 전체 해설지 → 단독 HTML 문서 (인쇄/PDF 저장용). */
export function renderStandaloneDocument(doc: KoreanExplanation, opts?: { stylesCss?: string; printFixCss?: string }): string {
  const title = `${doc.exam_title} — [${doc.set_range}] ${doc.work_title}`;
  const css = [opts?.stylesCss ?? '', opts?.printFixCss ?? ''].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
<style>${css}</style>
</head>
<body>
${renderBlocks(doc.blocks)}
</body>
</html>`;
}

// ── 블록별 렌더러 ──────────────────────────────────────────────────────────────

function renderCover(d: CoverData): string {
  const subtitle = d.show_subtitle
    ? `<div class="subtitle">LYCEUM ENGLISH ACADEMY · 학력평가 해설</div>`
    : '';
  return `<div class="cover-title">
${subtitle}
<h1>${escapeText(d.exam_title)}</h1>
<div class="meta">[${escapeText(d.set_range)}] ${escapeText(d.genre)} — ${escapeText(d.work_title)}</div>
</div>`;
}

function renderSectionHeader(d: SectionHeaderData): string {
  return `<div class="section-header"><span class="tag">${escapeText(d.tag)}</span>${escapeText(d.title)}</div>`;
}

function renderInfoBox(d: InfoBoxData): string {
  const rows = d.rows
    .map(r => `<div class="label">${escapeText(r.label)}</div><div class="value">${sanitizeInlineHtml(r.value_html)}</div>`)
    .join('\n');
  return `<div class="info-box">
<h3>${escapeText(d.heading)}</h3>
<div class="info-grid">
${rows}
</div>
</div>`;
}

function renderParagraphTable(d: ParagraphTableData): string {
  const thead = `<thead><tr>${d.columns.map(c => `<th>${escapeText(c)}</th>`).join('')}</tr></thead>`;
  const tbody = d.rows
    .map(r => {
      const tds = r.cells
        .map((cell, idx) => {
          const numClass = idx === 0 && d.first_col_is_paranum ? ' class="para-num"' : '';
          return `<td${numClass}>${sanitizeInlineHtml(cell)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('\n');
  return `<table class="paragraph-table">
${thead}
<tbody>
${tbody}
</tbody>
</table>`;
}

function renderTimeline(d: TimelineData): string {
  const items = d.items
    .map(it => `<div class="timeline-item">
<div class="timeline-time">${escapeText(it.time)}</div>
<div class="timeline-content">${sanitizeInlineHtml(it.content_html)}</div>
</div>`)
    .join('\n');
  return `<div class="timeline">
${items}
</div>`;
}

function renderCharacterGrid(d: CharacterGridData): string {
  const cards = d.cards
    .map(c => `<div class="character-card">
<div class="char-name">${escapeText(c.name)}</div>
<div class="char-role">${escapeText(c.role)}</div>
<div class="char-desc">${sanitizeInlineHtml(c.desc_html)}</div>
</div>`)
    .join('\n');
  const style = d.columns === 2 ? ' style="grid-template-columns: 1fr 1fr;"' : '';
  return `<div class="character-grid"${style}>
${cards}
</div>`;
}

/**
 * 비교 2단 — left/right 색 조합을 reference CSS 의 기존 클래스 페어로 매핑.
 *   navy/red   → ab-card.A / ab-card.B           (가장 흔함)
 *   navy/green → work-card.B / work-card.A
 *   green/red  → c3c4-card.c4 / c3c4-card.c3
 *   green/navy → work-card.A / work-card.B
 */
function renderCompare2Col(d: Compare2ColData): string {
  const map = compareClasses(d.left_color, d.right_color);
  const leftItems = d.left.items_html.map(li => `<li>${sanitizeInlineHtml(li)}</li>`).join('');
  const rightItems = d.right.items_html.map(li => `<li>${sanitizeInlineHtml(li)}</li>`).join('');
  return `<div class="${map.container}">
<div class="${map.left}">
<div class="${map.titleCls}">${escapeText(d.left.title)}</div>
<ul>${leftItems}</ul>
</div>
<div class="${map.right}">
<div class="${map.titleCls}">${escapeText(d.right.title)}</div>
<ul>${rightItems}</ul>
</div>
</div>`;
}

function compareClasses(left: Compare2ColData['left_color'], right: Compare2ColData['right_color']): {
  container: string;
  left: string;
  right: string;
  titleCls: string;
} {
  if (left === 'navy' && right === 'red') {
    return { container: 'ab-compare', left: 'ab-card A', right: 'ab-card B', titleCls: 'ab-title' };
  }
  if (left === 'navy' && right === 'navy') {
    return { container: 'ab-compare', left: 'ab-card A', right: 'ab-card A', titleCls: 'ab-title' };
  }
  if (left === 'green' && right === 'red') {
    return { container: 'c3c4-grid', left: 'c3c4-card c4', right: 'c3c4-card c3', titleCls: 'cc-name' };
  }
  if (left === 'green' && right === 'navy') {
    return { container: 'work-grid', left: 'work-card A', right: 'work-card B', titleCls: 'wc-title' };
  }
  // 폴백 — navy/red
  return { container: 'ab-compare', left: 'ab-card A', right: 'ab-card B', titleCls: 'ab-title' };
}

function renderConceptGrid(d: ConceptGridData): string {
  const cards = d.cards
    .map(c => `<div class="concept-card">
<div class="term">${escapeText(c.name)}</div>
<div class="desc">${sanitizeInlineHtml(c.desc_html)}</div>
</div>`)
    .join('\n');
  const style = d.columns === 2 ? ' style="grid-template-columns: 1fr 1fr;"' : '';
  return `<div class="concept-grid"${style}>
${cards}
</div>`;
}

function renderProcessDiagram(d: ProcessDiagramData): string {
  const title = d.title ? `<div class="pd-title">${escapeText(d.title)}</div>` : '';
  const showArrows = d.arrows !== false;
  const parts: string[] = [];
  d.nodes.forEach((n, i) => {
    const variant = n.variant ? ` ${n.variant}` : '';
    parts.push(`<div class="process-node${variant}">
<span class="pn-label">${escapeText(n.label)}</span>
<div class="pn-body">${sanitizeInlineHtml(n.body_html)}</div>
</div>`);
    if (showArrows && i < d.nodes.length - 1) {
      parts.push(`<div class="process-arrow">→</div>`);
    }
  });
  const cols = d.nodes.length;
  const arrowCount = showArrows ? Math.max(0, cols - 1) : 0;
  const colTemplate = showArrows
    ? Array.from({ length: cols + arrowCount }, (_, i) => (i % 2 === 0 ? '1fr' : '14mm')).join(' ')
    : Array.from({ length: cols }, () => '1fr').join(' ');
  return `<div class="process-diagram">
${title}
<div class="process-row" style="grid-template-columns: ${colTemplate};">
${parts.join('\n')}
</div>
</div>`;
}

function renderEmotionFlow(d: EmotionFlowData): string {
  const parts: string[] = [];
  d.stages.forEach((s, i) => {
    parts.push(`<div class="emotion-stage ${s.mood}">
<div class="es-label">${escapeText(s.label)}</div>
<div class="es-body">${sanitizeInlineHtml(s.body_html)}</div>
</div>`);
    if (i < d.stages.length - 1) {
      const arrowLabel = d.arrow_labels[i] ?? '';
      parts.push(`<div class="emotion-arrow">→<span class="ar-label">${escapeText(arrowLabel)}</span></div>`);
    }
  });
  // 동적 컬럼: stage 1fr, arrow 18mm 반복
  const cols = d.stages.length;
  const arrowCount = Math.max(0, cols - 1);
  const colTemplate = Array.from({ length: cols + arrowCount }, (_, i) => (i % 2 === 0 ? '1fr' : '18mm')).join(' ');
  return `<div class="emotion-flow" style="grid-template-columns: ${colTemplate};">
${parts.join('\n')}
</div>`;
}

function renderSijoBox(d: SijoBoxData): string {
  const entries = d.entries
    .map(e => `<div class="sijo-box">
<div class="sijo-num">제${escapeText(String(e.num))}수</div>
<div class="sijo-original">${escapeText(e.original)}</div>
<div class="sijo-modern">${sanitizeInlineHtml(e.modern_html)}</div>
</div>`)
    .join('\n');
  return entries;
}

function renderGistBox(d: GistBoxData): string {
  return `<div class="gist-box">
<div class="gist-label">${escapeText(d.label)}</div>
<div class="gist-body">${sanitizeInlineHtml(d.body_html)}</div>
</div>`;
}

function renderQuestion(d: QuestionData): string {
  const pointsBadge = d.points === 3 ? ' [3점]' : '';
  const evidences = (d.evidences ?? [])
    .map(e => `<div class="evidence-box">
<span class="ev-label">${escapeText(e.label)}</span><span class="ev-body">${sanitizeInlineHtml(e.body_html)}</span>
</div>`)
    .join('\n');
  const rows = d.choices
    .map(c => {
      const correctCls = c.n === d.correct_n ? ' class="correct"' : '';
      const judgeCls = c.judge === 'O' ? 'judge o' : 'judge x';
      const judgeMark = c.judge === 'O' ? 'O' : '✗';
      return `<tr${correctCls}>
<td class="choice-num">${escapeText(c.n)}</td>
<td class="${judgeCls}">${judgeMark}</td>
<td class="choice-text">${sanitizeInlineHtml(c.text_html)}</td>
</tr>`;
    })
    .join('\n');
  const trap = d.trap
    ? `<div class="trap-box">
<div class="trap-title">${escapeText(d.trap.title)}</div>
<div class="trap-body">${sanitizeInlineHtml(d.trap.body_html)}</div>
</div>`
    : '';
  return `<div class="question-block">
<div class="question-header">
<span class="q-num">${d.num}</span>
<span class="q-answer">${escapeText(d.answer)}</span>
<span class="q-intent"><strong>출제의도</strong> · ${escapeText(d.intent)}${pointsBadge}</span>
</div>
<div class="q-prompt">${sanitizeInlineHtml(d.prompt_html)}</div>
${evidences}
<table class="choice-table">
<thead><tr><th>번호</th><th>판단</th><th>해설</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${trap}
</div>`;
}
