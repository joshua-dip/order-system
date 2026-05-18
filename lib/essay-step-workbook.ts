/**
 * 서술형집중 워크북 — 한 지문 종합 8섹션 워크북 (프리미엄 판매용).
 *
 * Python WeasyPrint 템플릿(`서술형 대비 워크북 PDF 생성기`) 의 데이터 구조 + 디자인 톤을
 * Next.js 환경으로 이식. 같은 JSON 입력으로 동일한 출력물을 만든다.
 *
 * 8 섹션:
 *   1. 본문            — passage[] 줄번호와 함께 노출
 *   2. 어휘            — A 영영매칭 / B 영→한 / C 한→영 / D 동의·반의 / E 문맥상 어휘
 *   3. 어법            — A 틀린 부분 고치기 / B 네모 안 어법 / C 박스형 종합 어법
 *   4. 영작            — A 단어 배열 / B 우리말→영작 / C 조건 영작 / D 어형 변화
 *   5. 빈칸 완성        — A 한 단어 / B 어구 / C 첫 글자 힌트
 *   6. 해석 & 구문      — A 핵심문장 해석 / B 구문 분석
 *   7. 주제·요약·제목   — A 주제 한 문장 / B 요약문 빈칸 / C 제목
 *   8. 종합 서술형
 *   + Answer Key
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface EssayStepMeta {
  topic: string;
  topic_ko: string;
  academy: string;
  publisher: string;
}

/** 동의어/반의어 한 항목 — [기준 단어, 첫 글자 힌트 패턴, "동의어"|"반의어"] */
export type SynAntItem = [string, string, string];

/** 어법 틀린 부분 고치기 — [밑줄 포함 문장 HTML, 틀린 표현, 옳은 표현, 해설] */
export type GrammarFixItem = [string, string, string, string];

/** 네모 안 어법 — [`[[a/b]]` 마크업 포함 문장, 정답, 해설] */
export type GrammarBoxItem = [string, string, string];

/** 박스형 종합 어법 답 한 줄 — [번호(원문자), 고친 표현, 해설] */
export type GrammarPassageAnswer = [string, string, string];

export interface WordArrangeItem {
  ko: string;
  /** 슬래시 구분 단어 묶음 (예: "feel / inspired / your / want") */
  words: string;
  ans: string;
}

/** 한→영 한 항목 */
export type KoToEnItem = [string, string];

export interface CondWriteItem {
  ko: string;
  /** 조건 1줄당 항목. 인라인 HTML(<span class='en'>...</span>) 허용 */
  conds: string[];
  ans: string;
}

/** 어형 변화 — [괄호 동사 포함 문장, 정답, 해설] */
export type InflectionItem = [string, string, string];

/** 빈칸 한 단어 / 어구 — [밑줄 포함 문장, 정답] */
export type BlankItem = [string, string];

/** 빈칸 첫 글자 힌트 — [한국어 의미, 힌트(첫 글자 + _____), 정답] */
export type BlankFirstLetterItem = [string, string, string];

export interface SyntaxAnalysisItem {
  /** 분석 대상 문장 (HTML — <u>...</u> 로 핵심 부분 표시) */
  sent: string;
  /** 질문 */
  q: string;
  /** 모범답안 (HTML) */
  ans: string;
}

export interface SummaryBlock {
  /** (A)(B)(C)(D) 같은 빈칸이 들어간 요약문 텍스트 (HTML 가능) */
  text: string;
  /** 빈칸 정답 (예: "(A) overwhelmed (B) inspired (C) streamlining (D) packed") */
  ans: string;
}

export interface ComprehensiveItem {
  q: string;
  ans: string;
}

export interface EssayStepWorkbookData {
  meta: EssayStepMeta;
  passage: string[];
  /** 본문 한국어 해석 — passage 와 같은 길이. 있으면 Section 1 이 좌우 2단(EN/KO)으로 렌더. 비우거나 없으면 단일 컬럼. */
  passage_ko?: string[];
  vocab: KoToEnItem[];
  definitions: KoToEnItem[];
  /** 영영 정의 매칭 셔플 인덱스 (`definitions[def_shuffle[i]]` 가 i 번째 항목 옆에 노출) */
  def_shuffle: number[];
  syn_ant: SynAntItem[];
  syn_ant_answers: string[];
  /** 문맥상 어휘 — [선택지 포함 문장 HTML, 정답] */
  context_choices: BlankItem[];
  grammar_fix: GrammarFixItem[];
  grammar_box: GrammarBoxItem[];
  grammar_passage: string;
  grammar_passage_answers: GrammarPassageAnswer[];
  grammar_passage_summary: string;
  word_arrange: WordArrangeItem[];
  ko_to_en: KoToEnItem[];
  cond_write: CondWriteItem[];
  inflection: InflectionItem[];
  blank_one_word: BlankItem[];
  blank_phrase: BlankItem[];
  blank_first_letter: BlankFirstLetterItem[];
  translation_sentences: string[];
  translation_answers: string[];
  syntax_analysis: SyntaxAnalysisItem[];
  theme_answer: string;
  summary: SummaryBlock;
  title_examples: string[];
  comprehensive: ComprehensiveItem[];
}

export interface EssayStepBuildOptions {
  data: EssayStepWorkbookData;
  /** 'student' | 'all' (학생용 + 정답키) */
  mode?: 'student' | 'all';
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `[[A/B]]` 마크업을 네모박스 HTML 로 변환 (Python render_box_inline 동등). */
function renderBoxInline(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, pair: string) => {
    const [a, b] = pair.split('/').map(s => s.trim());
    return `<span class='boxed'>${escapeHtml(a)}</span><span class='slash'>/</span><span class='boxed'>${escapeHtml(b)}</span>`;
  });
}

/** 문맥상 어휘 — Python 의 정규식 변환 동등. <b>x</b> / y 형태를 두 boxed 로. */
function renderContextChoice(sentHtml: string): string {
  let s = sentHtml.replace(/<b>/g, "<span class='boxed'>").replace(/<\/b>/g, '</span>');
  s = s.replace(/ \/ /g, "<span class='slash'>/</span>");
  // 두 번째 옵션도 boxed (파이썬 정규식과 동등)
  s = s.replace(
    /<\/span><span class='slash'>\/<\/span>\s*([\w'-]+)/,
    "</span><span class='slash'>/</span><span class='boxed'>$1</span>",
  );
  return s;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const SHARED_CSS = `
@page { size: A4; margin: 18mm 15mm 18mm 18mm; }
* { box-sizing: border-box; }
html, body {
  font-family: 'Noto Sans CJK KR', 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif;
  font-size: 10.5pt; line-height: 1.55; color: #222; margin: 0; padding: 0; background: #fff;
}
.en { font-family: 'Noto Serif CJK KR', 'Noto Serif KR', 'Times New Roman', serif; }

/* 표지 */
.cover { page-break-after: always; padding: 50mm 6mm 0; text-align: center; }
.cover .badge {
  display: inline-block; padding: 4px 14px;
  border: 1.5px solid #1F4E79; color: #1F4E79;
  font-size: 10pt; letter-spacing: 2px; font-weight: 600; border-radius: 20px;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
.cover h1 { font-size: 28pt; margin: 18px 0 8px; color: #111; letter-spacing: -1px; }
.cover .subtitle { font-size: 12pt; color: #555; margin-bottom: 30px; font-family: 'Noto Sans CJK KR', sans-serif; }
.cover .topic-card {
  margin: 30px 4mm 0; border: 1px solid #d8d8d8; border-radius: 4px;
  padding: 16px 20px; text-align: left; background: #fafafa;
}
.cover .topic-card .label {
  font-size: 9pt; color: #1F4E79; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
.cover .topic-card .topic { font-size: 14pt; font-weight: 600; color: #222; }
.cover .meta { margin-top: 30px; font-size: 10pt; color: #777; font-family: 'Noto Sans CJK KR', sans-serif; }
.cover .toc { text-align: left; margin: 30px 4mm 0; font-size: 10pt; }
.cover .toc h3 {
  font-size: 11pt; color: #1F4E79; border-bottom: 2px solid #1F4E79;
  padding-bottom: 4px; margin-bottom: 10px; font-family: 'Noto Sans CJK KR', sans-serif;
}
.cover .toc ul { list-style: none; padding: 0; margin: 0; }
.cover .toc li {
  padding: 5px 0; border-bottom: 1px dotted #ccc;
  display: flex; justify-content: space-between;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
.cover .toc li .num {
  color: #1F4E79; font-weight: 700; margin-right: 10px; font-family: 'Times New Roman', serif;
}

/* 섹션 헤더 */
.section-header {
  background: #1F4E79; color: #fff; padding: 8px 14px; margin: 16px 0 10px;
  border-radius: 3px; page-break-after: avoid; page-break-inside: avoid;
  font-family: 'Noto Sans CJK KR', sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.section-header .num {
  font-family: 'Times New Roman', serif; font-size: 12pt; font-weight: 700;
  margin-right: 8px; letter-spacing: 1px;
}
.section-header .title-ko { font-size: 13pt; font-weight: 700; }
.section-header .title-en { font-size: 9.5pt; opacity: 0.85; margin-left: 6px; }

/* 소제목 */
.sub-header {
  border-left: 4px solid #1F4E79; padding-left: 8px; margin: 14px 0 8px;
  font-size: 11pt; font-weight: 700; color: #1F4E79; page-break-after: avoid;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
.instruction { font-size: 9.5pt; color: #666; font-style: italic; margin: 0 0 8px 12px; font-family: 'Noto Sans CJK KR', sans-serif; }

/* 본문 박스 */
.passage {
  background: #f7f7f7; border: 1px solid #d4d4d4; border-left: 4px solid #1F4E79;
  padding: 14px 18px; font-family: 'Noto Serif CJK KR', 'Times New Roman', serif;
  font-size: 11pt; line-height: 1.85; margin: 8px 0; page-break-inside: avoid;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.passage .ln {
  display: inline-block; width: 22px; color: #1F4E79; font-weight: 700;
  font-family: 'Times New Roman', serif; font-size: 9pt; vertical-align: top;
}
.passage p { margin: 4px 0; }

/* 본문 & 해석 — 좌우 2단 (passage_ko 가 있을 때) */
.passage-bilingual {
  border-top: 2px solid #1F4E79;
  border-bottom: 2px solid #1F4E79;
  margin: 8px 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.bi-row {
  display: grid;
  grid-template-columns: 26px 1.5fr 1fr;
  gap: 0;
  border-bottom: 0.4px dashed #ccc;
  padding: 4px 0;
}
.bi-row:last-child { border-bottom: none; }
.bi-ln {
  color: #1F4E79; font-weight: 700;
  font-family: 'Times New Roman', serif; font-size: 9pt;
  text-align: right; padding-right: 6px; padding-top: 2px;
}
.bi-en {
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif;
  font-size: 10.5pt; line-height: 1.7;
  padding: 0 12px 0 4px;
  border-right: 0.6px solid #ccc;
}
.bi-ko {
  font-family: 'Noto Sans CJK KR', sans-serif;
  font-size: 10pt; line-height: 1.7;
  padding: 0 4px 0 12px;
  color: #333;
}
.bi-ko-empty { color: #b45309; font-style: italic; font-size: 9pt; }

/* 문제 */
.q { margin: 8px 0; font-size: 10.5pt; page-break-inside: avoid; font-family: 'Noto Sans CJK KR', sans-serif; }
.q-num { color: #1F4E79; font-weight: 700; font-family: 'Times New Roman', serif; margin-right: 4px; }
.q-ko { font-family: 'Noto Sans CJK KR', sans-serif; }
.q-en {
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif;
  font-size: 10.5pt; margin: 4px 0 4px 16px; line-height: 1.7;
}

/* 답 줄 */
.line { border-bottom: 1px solid #888; height: 22px; margin: 6px 0; }
.line.short { width: 60%; }
.line.tiny {
  display: inline-block; min-width: 60px; height: 14px;
  vertical-align: bottom; margin: 0 4px;
}

/* 점선 박스 */
.dashed-box {
  border: 1.2px dashed #888; padding: 10px 14px; margin: 6px 0 10px 16px;
  min-height: 36px; font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; font-size: 10.5pt;
}

/* 보기/조건 박스 */
.choice-box {
  border: 1px solid #999; padding: 8px 12px; margin: 6px 0 10px 16px;
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif;
  font-size: 10.5pt; font-style: italic; background: #fafafa;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.cond-box {
  border: 1px solid #999; padding: 8px 12px; margin: 6px 0 10px 16px;
  background: #fafafa; font-size: 10pt; font-family: 'Noto Sans CJK KR', sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.cond-box .cond-title { font-weight: 700; font-size: 9.5pt; color: #1F4E79; margin-bottom: 4px; }
.cond-box ul { margin: 0; padding-left: 18px; }
.cond-box li { padding: 1px 0; }

/* 표 */
table.qtbl {
  width: calc(100% - 16px); border-collapse: collapse; margin: 6px 0 10px 16px;
  font-size: 10pt; page-break-inside: avoid;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
table.qtbl th {
  background: #1F4E79; color: #fff; font-weight: 700; font-size: 9.5pt;
  padding: 6px 8px; text-align: left; border: 1px solid #1F4E79;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
table.qtbl td {
  padding: 7px 9px; border: 1px solid #c0c0c0; vertical-align: middle; height: 20px;
}
table.qtbl td.num {
  width: 28px; text-align: center; background: #f4f4f4;
  font-family: 'Times New Roman', serif; font-weight: 700; color: #555;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
table.qtbl td.term { width: 42%; font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; }
table.qtbl td.term-ko { width: 42%; }
table.qtbl td.ans { background: #fafafa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* 매칭 */
table.match { width: calc(100% - 16px); margin-left: 16px; border-collapse: collapse; font-size: 10pt; font-family: 'Noto Sans CJK KR', sans-serif; }
table.match td { padding: 6px 8px; vertical-align: middle; }
table.match td.l-num {
  width: 24px; text-align: center; background: #f4f4f4; border: 1px solid #ccc;
  font-family: 'Times New Roman', serif; font-weight: 700;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
table.match td.l-term {
  width: 28%; border: 1px solid #ccc;
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; font-weight: 600;
}
table.match td.l-ans {
  width: 50px; text-align: center; border: 1px solid #ccc; background: #fafafa;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
table.match td.r-letter {
  width: 24px; text-align: center; background: #f4f4f4; border: 1px solid #ccc;
  font-family: 'Times New Roman', serif; font-weight: 700;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
table.match td.r-def {
  border: 1px solid #ccc;
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; font-size: 9.8pt;
}

/* 박스형 어법 */
.grammar-box-passage {
  background: #f7f7f7; border: 1px solid #ccc; padding: 12px 16px;
  margin: 6px 0 10px 16px; font-family: 'Noto Serif CJK KR', 'Times New Roman', serif;
  font-size: 10.5pt; line-height: 1.9;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.gnum {
  /* inline-flex 로 원형·중앙 정렬 보장 (html2canvas 안정) */
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: 1.5px solid #1F4E79; border-radius: 50%;
  font-family: 'Times New Roman', serif;
  font-size: 9pt; font-weight: 700; color: #1F4E79;
  margin: 0 2px; background: #fff;
  vertical-align: middle;  /* baseline 흔들림 없도록 */
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

/* 네모 안 어법 — html2canvas 가 타이트한 inline-block + 작은 padding 에서 border 를
 * 글자 가운데에 그리는 버그가 있어, .cover .badge 와 같은 「넉넉한 padding + 명시 배경 +
 * 약간 둥근 모서리」로 우회. line-height 1.2 로 글자가 박스 안에서 답답하지 않도록. */
.boxed {
  display: inline-block;
  padding: 4px 10px; margin: 0 3px;
  border: 1.5px solid #1f2937; border-radius: 3px;
  background: #fff;
  line-height: 1.2;
  font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; font-weight: 700;
  vertical-align: middle;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.slash { font-weight: 700; margin: 0 6px; color: #6b7280; }

/* 정답 키 */
.answer-section {
  page-break-before: always; border-top: 3px double #1F4E79; padding-top: 8px;
}
.answer-section .answer-title {
  text-align: center; font-size: 16pt; font-weight: 700; color: #1F4E79;
  margin: 4px 0 14px; letter-spacing: 4px;
  font-family: 'Noto Sans CJK KR', sans-serif;
}
.ans-block { margin: 8px 0 14px; font-size: 10pt; font-family: 'Noto Sans CJK KR', sans-serif; }
.ans-block .a-head {
  font-weight: 700; color: #1F4E79; border-bottom: 1px solid #1F4E79;
  padding-bottom: 2px; margin-bottom: 6px; font-size: 11pt;
}
.ans-block ol { margin: 4px 0 4px 20px; padding: 0; }
.ans-block ol li { padding: 2px 0; line-height: 1.6; }
.ans-block .en { font-family: 'Noto Serif CJK KR', 'Times New Roman', serif; }
.ans-note {
  background: #fff8e1; border-left: 3px solid #f0a500; padding: 4px 10px;
  margin: 4px 0; font-size: 9.5pt; color: #6a4c00;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

/* 유틸 */
.kw { font-weight: 700; color: #c0392b; }
.small { font-size: 9pt; color: #777; }
`;

// ── HTML 렌더링 ───────────────────────────────────────────────────────────────

function sectionHeader(num: string, ko: string, en: string): string {
  return `<div class="section-header">
  <span class="num">SECTION ${num}.</span>
  <span class="title-ko">${escapeHtml(ko)}</span>
  <span class="title-en">${escapeHtml(en)}</span>
</div>`;
}

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${SHARED_CSS}</style></head><body>${body}</body></html>`;
}

function buildCover(data: EssayStepWorkbookData): string {
  const tocItems: Array<[string, string]> = [
    ['1', '본문 / Original Passage'],
    ['2', '어휘 / Vocabulary'],
    ['3', '어법 / Grammar'],
    ['4', '영작 / Writing'],
    ['5', '빈칸 완성 / Fill in the Blanks'],
    ['6', '해석 & 구문 / Translation & Syntax'],
    ['7', '주제·요약·제목 / Theme · Summary · Title'],
    ['8', '종합 서술형 / Comprehensive'],
    ['★', '정답 / Answer Key'],
  ];
  const toc = tocItems
    .map(([n, t]) => `<li><span><span class="num">${escapeHtml(n)}.</span>${escapeHtml(t)}</span></li>`)
    .join('');
  const m = data.meta;
  return `<div class="cover">
  <div class="badge">SERIAL · 서술형 종합 워크북</div>
  <h1>${escapeHtml(m.topic)}</h1>
  <div class="subtitle">한 지문 종합 정리 · 8 SECTIONS</div>
  <div class="topic-card">
    <div class="label">PASSAGE TOPIC</div>
    <div class="topic">${escapeHtml(m.topic)}</div>
    <div class="small" style="margin-top:6px;">${escapeHtml(m.topic_ko)}</div>
  </div>
  <div class="toc">
    <h3>CONTENTS</h3>
    <ul>${toc}</ul>
  </div>
  <div class="meta">${escapeHtml(m.academy)} · ${escapeHtml(m.publisher)}</div>
</div>`;
}

function buildSection1(data: EssayStepWorkbookData): string {
  const ko = data.passage_ko;
  const isBilingual = Array.isArray(ko) && ko.length === data.passage.length && ko.some(s => s && s.trim());

  if (isBilingual) {
    const rows = data.passage
      .map((en, i) => {
        const k = (ko![i] ?? '').trim();
        return `<div class="bi-row">
  <div class="bi-ln">${String(i + 1).padStart(2, '0')}</div>
  <div class="bi-en">${escapeHtml(en)}</div>
  <div class="bi-ko">${k ? escapeHtml(k) : '<span class="bi-ko-empty">(해석 미입력)</span>'}</div>
</div>`;
      })
      .join('');
    return `${sectionHeader('1', '본문 & 해석', 'Original Passage / Korean Translation')}
<div class="instruction">좌측 영문, 우측 한국어 해석. 좌측 번호는 모든 섹션에서 "행(line)" 참조 번호.</div>
<div class="passage-bilingual">${rows}</div>`;
  }

  // fallback — 기존 단일 컬럼
  const lines = data.passage
    .map((line, i) => `<p><span class="ln">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(line)}</p>`)
    .join('');
  return `${sectionHeader('1', '본문', 'Original Passage')}
<div class="instruction">아래 지문을 정독한 뒤, 각 섹션의 문항을 풀어보세요. 좌측 번호는 모든 섹션에서 "행(line)" 참조 번호로 사용됩니다.</div>
<div class="passage">${lines}</div>`;
}

function buildSection2(data: EssayStepWorkbookData): string {
  // 2-A 영영 매칭
  const matchRows = data.definitions
    .map((_, i) => {
      const word = data.definitions[i][0];
      const defi = data.definitions[data.def_shuffle[i] ?? i]?.[1] ?? '';
      const letter = String.fromCharCode(97 + i);
      return `<tr><td class="l-num">${i + 1}</td>
<td class="l-term en">${escapeHtml(word)}</td>
<td class="l-ans">(   )</td>
<td class="r-letter">${letter}</td>
<td class="r-def en">${escapeHtml(defi)}</td></tr>`;
    })
    .join('');

  // 2-B 영→한
  const bRows = data.vocab
    .map(([en], i) => `<tr><td class="num">${i + 1}</td><td class="term en">${escapeHtml(en)}</td><td class="ans"></td></tr>`)
    .join('');

  // 2-C 한→영
  const cRows = data.vocab
    .map(([, ko], i) => `<tr><td class="num">${i + 1}</td><td class="term-ko">${escapeHtml(ko)}</td><td class="ans en"></td></tr>`)
    .join('');

  // 2-D 동의/반의
  const dRows = data.syn_ant
    .map(([w, fill, t], i) => `<tr><td class="num">${i + 1}</td><td class="en">${escapeHtml(w)}</td><td class="en ans">${escapeHtml(fill)}</td><td>${escapeHtml(t)}</td></tr>`)
    .join('');

  // 2-E 문맥상 어휘
  const eItems = data.context_choices
    .map(([sent], i) => `<div class="q-en"><span class="q-num">${i + 1}.</span> ${renderContextChoice(sent)}</div>`)
    .join('');

  return `${sectionHeader('2', '어휘', 'Vocabulary')}
<div class="sub-header">2-A. 영영 정의 매칭</div>
<div class="instruction">왼쪽 단어와 오른쪽 영영 정의를 알맞게 연결하시오. (좌측 빈칸에 알파벳 기호 a~h 기입)</div>
<table class="match">${matchRows}</table>

<div class="sub-header">2-B. 영어 단어/표현의 우리말 뜻을 쓰시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th>English</th><th>우리말 뜻</th></tr>${bRows}</table>

<div class="sub-header">2-C. 우리말 뜻에 해당하는 영어 단어/표현을 쓰시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th>우리말</th><th>English</th></tr>${cRows}</table>

<div class="sub-header">2-D. 동의어 / 반의어</div>
<div class="instruction">아래 빈칸에 어울리는 동의어 또는 반의어를 영어로 쓰시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th style="width:30%;">단어</th><th>채울 칸</th><th style="width:60px;">유형</th></tr>${dRows}</table>

<div class="sub-header">2-E. 문맥상 어휘 — 알맞은 단어를 고르시오.</div>
${eItems}`;
}

function buildSection3(data: EssayStepWorkbookData): string {
  // 3-A 틀린 부분 고치기
  const aItems = data.grammar_fix
    .map(([sent], i) => `<div class="q-en"><span class="q-num">${i + 1}.</span> ${sent}</div>
<div class="dashed-box" style="margin-left:16px;min-height:24px;"><span class="small">→ 고친 표현: </span><span class="line tiny" style="min-width:140px;"></span></div>`)
    .join('');

  // 3-B 네모 안 어법
  const bItems = data.grammar_box
    .map(([sent], i) => `<div class="q-en"><span class="q-num">${i + 1}.</span> ${renderBoxInline(sent)}</div>`)
    .join('');

  return `${sectionHeader('3', '어법', 'Grammar')}
<div class="sub-header">3-A. 어법상 틀린 부분을 찾아 바르게 고치시오.</div>
<div class="instruction">밑줄 친 부분이 어법상 틀린 경우, 바르게 고쳐 쓰시오.</div>
${aItems}

<div class="sub-header">3-B. 네모 안 어법 선택</div>
<div class="instruction">네모 안에서 어법상 알맞은 표현을 골라 ○표 하시오.</div>
${bItems}

<div class="sub-header">3-C. 박스형 종합 어법</div>
<div class="instruction">아래 글에서 어법상 <span class="kw">틀린</span> 것을 모두 찾아, 번호와 바르게 고친 표현을 쓰시오.</div>
<div class="grammar-box-passage">${data.grammar_passage}</div>
<div class="dashed-box" style="min-height:64px;"><span class="small">→ 틀린 번호 / 고친 표현:</span></div>`;
}

function buildSection4(data: EssayStepWorkbookData): string {
  const aItems = data.word_arrange
    .map((it, i) => `<div class="q"><span class="q-num">${i + 1}.</span> ${escapeHtml(it.ko)}</div>
<div class="choice-box">${escapeHtml(it.words)}</div>
<div class="line" style="margin-left:16px;"></div>`)
    .join('');

  const bItems = data.ko_to_en
    .map(([ko], i) => `<div class="q"><span class="q-num">${i + 1}.</span> ${escapeHtml(ko)}</div>
<div class="line" style="margin-left:16px;"></div><div class="line" style="margin-left:16px;"></div>`)
    .join('');

  const cItems = data.cond_write
    .map((it, i) => {
      const condLis = it.conds.map(c => `<li>${c}</li>`).join('');
      return `<div class="q"><span class="q-num">${i + 1}.</span> ${escapeHtml(it.ko)}</div>
<div class="cond-box"><div class="cond-title">&lt;조건&gt;</div><ul>${condLis}</ul></div>
<div class="line" style="margin-left:16px;"></div><div class="line" style="margin-left:16px;"></div>`;
    })
    .join('');

  const dRows = data.inflection
    .map(([sent], i) => `<tr><td class="num">${i + 1}</td><td class="en">${sent}</td><td class="ans en"></td></tr>`)
    .join('');

  return `${sectionHeader('4', '영작', 'Writing')}
<div class="sub-header">4-A. 단어 배열</div>
<div class="instruction">제시된 단어를 모두 사용하여 우리말에 맞게 영작하시오. (필요 시 어형 변화 없음)</div>
${aItems}

<div class="sub-header">4-B. 우리말을 영어로 옮기시오.</div>
${bItems}

<div class="sub-header">4-C. 조건 영작</div>
${cItems}

<div class="sub-header">4-D. 어형 변화 영작</div>
<div class="instruction">괄호 안의 단어를 문맥과 어법에 맞게 변형하여 빈칸을 채우시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th>문장</th><th style="width:30%;">변형 어형</th></tr>${dRows}</table>`;
}

function buildSection5(data: EssayStepWorkbookData): string {
  const aRows = data.blank_one_word
    .map(([sent], i) => `<tr><td class="num">${i + 1}</td><td class="en">${sent}</td><td class="ans en"></td></tr>`)
    .join('');

  const bItems = data.blank_phrase
    .map(([sent], i) => `<div class="q-en"><span class="q-num">${i + 1}.</span> ${sent}</div>
<div class="line short" style="margin-left:16px;"></div>`)
    .join('');

  const cRows = data.blank_first_letter
    .map(([ko, hint], i) => `<tr><td class="num">${i + 1}</td><td>${escapeHtml(ko)}</td><td class="en ans"><b>${escapeHtml(hint)}</b></td></tr>`)
    .join('');

  return `${sectionHeader('5', '빈칸 완성', 'Fill in the Blanks')}
<div class="sub-header">5-A. 빈칸에 알맞은 한 단어를 쓰시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th>문장</th><th style="width:18%;">정답</th></tr>${aRows}</table>

<div class="sub-header">5-B. 빈칸에 알맞은 어구를 쓰시오.</div>
${bItems}

<div class="sub-header">5-C. 첫 글자 힌트로 어휘 채우기</div>
<div class="instruction">우리말 뜻에 해당하는 단어를 첫 글자 힌트를 보고 완성하시오.</div>
<table class="qtbl"><tr><th style="width:28px;">#</th><th style="width:42%;">우리말 뜻</th><th>철자</th></tr>${cRows}</table>`;
}

function buildSection6(data: EssayStepWorkbookData): string {
  const aItems = data.translation_sentences
    .map((sent, i) => `<div class="q-en"><span class="q-num">${i + 1}.</span> ${escapeHtml(sent)}</div>
<div class="dashed-box"></div>`)
    .join('');

  const bItems = data.syntax_analysis
    .map((it, i) => `<div class="q"><span class="q-num">${i + 1}.</span> <span class="q-ko">${it.q}</span></div>
<div class="q-en">▷ ${it.sent}</div>
<div class="dashed-box"></div>`)
    .join('');

  return `${sectionHeader('6', '해석 & 구문', 'Translation & Syntax')}
<div class="sub-header">6-A. 핵심 문장 해석</div>
${aItems}

<div class="sub-header">6-B. 구문 분석</div>
${bItems}`;
}

function buildSection7(data: EssayStepWorkbookData): string {
  return `${sectionHeader('7', '주제·요약·제목', 'Theme · Summary · Title')}
<div class="sub-header">7-A. 주제 한 문장 영작</div>
<div class="instruction">본문의 주제를 영어 한 문장으로 작성하시오. (10~15단어)</div>
<div class="line"></div><div class="line"></div>

<div class="sub-header">7-B. 요약문 빈칸 완성</div>
<div class="instruction">아래 요약문의 빈칸 (A)~(D)를 본문 어휘로 채우시오.</div>
<div class="passage" style="border-left-color:#f0a500;background:#fffaf0;">${data.summary.text}</div>
<div style="margin-left:16px;font-size:10pt;">
  (A) <span class="line tiny" style="min-width:120px;"></span>
  &nbsp;&nbsp;(B) <span class="line tiny" style="min-width:120px;"></span><br>
  (C) <span class="line tiny" style="min-width:120px;"></span>
  &nbsp;&nbsp;(D) <span class="line tiny" style="min-width:120px;"></span>
</div>

<div class="sub-header">7-C. 제목 영작</div>
<div class="instruction">본문에 가장 어울리는 제목을 영어로 작성하시오. (단, 핵심 키워드를 반드시 포함할 것)</div>
<div class="line short"></div>`;
}

function buildSection8(data: EssayStepWorkbookData): string {
  const items = data.comprehensive
    .map((it, i) => `<div class="q"><span class="q-num">${i + 1}.</span> <span class="q-ko">${it.q}</span></div>
<div class="dashed-box" style="min-height:60px;"></div>`)
    .join('');
  return `${sectionHeader('8', '종합 서술형', 'Comprehensive')}
${items}`;
}

function buildAnswerKey(data: EssayStepWorkbookData): string {
  // 2-A 매칭 정답 (i+1 - shuffle.indexOf(i))
  const matchPairs = data.definitions.map((_, i) => {
    const j = data.def_shuffle.indexOf(i);
    return `${i + 1}-${j >= 0 ? String.fromCharCode(97 + j) : '?'}`;
  });

  const vocabItems = data.vocab
    .map(([en, ko]) => `<li><span class="en"><b>${escapeHtml(en)}</b></span> — ${escapeHtml(ko)}</li>`)
    .join('');

  const synAntItems = data.syn_ant_answers.map(s => `<li>${escapeHtml(s)}</li>`).join('');

  const ctxAns = data.context_choices
    .map(([, a], i) => `${i + 1}) ${escapeHtml(a)}`)
    .join(' &nbsp; ');

  const grammarFixItems = data.grammar_fix
    .map(([, wrong, right, why]) => `<li><span class="en"><b>${escapeHtml(wrong)}</b> → <b style="color:#1F4E79;">${escapeHtml(right)}</b></span> &nbsp; <span class="small">(${escapeHtml(why)})</span></li>`)
    .join('');

  const grammarBoxItems = data.grammar_box
    .map(([, correct, why]) => `<li><span class="en"><b>${escapeHtml(correct)}</b></span> &nbsp; <span class="small">(${escapeHtml(why)})</span></li>`)
    .join('');

  const grammarPassageRows = data.grammar_passage_answers
    .map(([n, fix, why]) => `${escapeHtml(n)} <span class="en">${escapeHtml(fix)}</span> (${escapeHtml(why)})<br>`)
    .join('');

  const wordArrItems = data.word_arrange.map(it => `<li>${escapeHtml(it.ans)}</li>`).join('');
  const koToEnItems = data.ko_to_en.map(([, en]) => `<li>${escapeHtml(en)}</li>`).join('');
  const condItems = data.cond_write.map(it => `<li class="en">${escapeHtml(it.ans)}</li>`).join('');
  const inflItems = data.inflection
    .map(([, ans, why]) => `<li><span class="en"><b>${escapeHtml(ans)}</b></span> &nbsp; <span class="small">(${escapeHtml(why)})</span></li>`)
    .join('');

  const blankOneAns = data.blank_one_word
    .map(([, w], i) => `${i + 1}) <b>${escapeHtml(w)}</b>`)
    .join(' &nbsp; ');
  const blankPhraseItems = data.blank_phrase.map(([, ans]) => `<li>${escapeHtml(ans)}</li>`).join('');
  const blankFirstAns = data.blank_first_letter
    .map(([, , w], i) => `${i + 1}) <b>${escapeHtml(w)}</b>`)
    .join(' &nbsp; ');

  const transItems = data.translation_answers.map(t => `<li>${escapeHtml(t)}</li>`).join('');
  const syntaxItems = data.syntax_analysis.map(it => `<li>${it.ans}</li>`).join('');

  const titleItems = data.title_examples.map(t => `· ${escapeHtml(t)}`).join('<br>');

  const compItems = data.comprehensive
    .map(it => `<li>${escapeHtml(it.ans)}</li>`)
    .join('');

  return `<div class="answer-section">
  <div class="answer-title">ANSWER KEY · 정답</div>

  <div class="ans-block">
    <div class="a-head">SECTION 2 · 어휘</div>
    <div><b>2-A. 영영 정의 매칭</b></div>
    <div class="en">${matchPairs.join(' &nbsp; ')}</div>
    <div style="margin-top:6px;"><b>2-B. 영→한</b></div><ol>${vocabItems}</ol>
    <div style="margin-top:6px;"><b>2-C. 한→영</b> (2-B와 짝)</div>
    <div style="margin-top:6px;"><b>2-D. 동의어/반의어</b></div><ol>${synAntItems}</ol>
    <div style="margin-top:6px;"><b>2-E. 문맥상 어휘</b></div>
    <div class="en">${ctxAns}</div>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 3 · 어법</div>
    <div><b>3-A. 틀린 부분 고치기</b></div><ol>${grammarFixItems}</ol>
    <div style="margin-top:6px;"><b>3-B. 네모 안 어법</b></div><ol>${grammarBoxItems}</ol>
    <div style="margin-top:6px;"><b>3-C. 박스형 종합 어법</b></div>
    <div>${grammarPassageRows}</div>
    <div class="ans-note">→ ${escapeHtml(data.grammar_passage_summary)}</div>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 4 · 영작</div>
    <div><b>4-A. 단어 배열</b></div><ol class="en">${wordArrItems}</ol>
    <div style="margin-top:6px;"><b>4-B. 우리말 → 영작</b></div><ol class="en">${koToEnItems}</ol>
    <div style="margin-top:6px;"><b>4-C. 조건 영작</b></div><ol>${condItems}</ol>
    <div style="margin-top:6px;"><b>4-D. 어형 변화</b></div><ol>${inflItems}</ol>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 5 · 빈칸 완성</div>
    <div><b>5-A. 한 단어</b></div>
    <div class="en">${blankOneAns}</div>
    <div style="margin-top:6px;"><b>5-B. 어구</b></div><ol class="en">${blankPhraseItems}</ol>
    <div style="margin-top:6px;"><b>5-C. 첫 글자 힌트</b></div>
    <div class="en">${blankFirstAns}</div>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 6 · 해석 &amp; 구문</div>
    <div><b>6-A. 핵심 문장 해석</b></div><ol>${transItems}</ol>
    <div style="margin-top:6px;"><b>6-B. 구문 분석</b></div><ol>${syntaxItems}</ol>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 7 · 주제·요약·제목</div>
    <div><b>7-A. 주제문 (예시)</b></div>
    <div class="en">${escapeHtml(data.theme_answer)}</div>
    <div style="margin-top:6px;"><b>7-B. 요약문</b></div>
    <div class="en">${escapeHtml(data.summary.ans)}</div>
    <div style="margin-top:6px;"><b>7-C. 제목 (예시)</b></div>
    <div class="en">${titleItems}</div>
  </div>

  <div class="ans-block">
    <div class="a-head">SECTION 8 · 종합 서술형</div>
    <ol>${compItems}</ol>
  </div>
</div>`;
}

/** 학생용 + 정답키 통합 (인쇄/PDF). */
export function buildEssayStepCombinedHtml(opts: EssayStepBuildOptions): string {
  const { data } = opts;
  const body = `${buildCover(data)}
${buildSection1(data)}
${buildSection2(data)}
${buildSection3(data)}
${buildSection4(data)}
${buildSection5(data)}
${buildSection6(data)}
${buildSection7(data)}
${buildSection8(data)}
${buildAnswerKey(data)}`;
  return htmlShell(`${data.meta.topic} — 서술형집중 워크북`, body);
}

/** 학생용만 (정답키 없음). */
export function buildEssayStepStudentHtml(opts: EssayStepBuildOptions): string {
  const { data } = opts;
  const body = `${buildCover(data)}
${buildSection1(data)}
${buildSection2(data)}
${buildSection3(data)}
${buildSection4(data)}
${buildSection5(data)}
${buildSection6(data)}
${buildSection7(data)}
${buildSection8(data)}`;
  return htmlShell(`${data.meta.topic} — 서술형집중 워크북`, body);
}

/** 빈/디폴트 데이터 — UI 초기 상태에 사용. */
export function emptyEssayStepData(): EssayStepWorkbookData {
  return {
    meta: { topic: '제목 미입력', topic_ko: '', academy: '', publisher: '' },
    passage: [],
    passage_ko: [],
    vocab: [],
    definitions: [],
    def_shuffle: [],
    syn_ant: [],
    syn_ant_answers: [],
    context_choices: [],
    grammar_fix: [],
    grammar_box: [],
    grammar_passage: '',
    grammar_passage_answers: [],
    grammar_passage_summary: '',
    word_arrange: [],
    ko_to_en: [],
    cond_write: [],
    inflection: [],
    blank_one_word: [],
    blank_phrase: [],
    blank_first_letter: [],
    translation_sentences: [],
    translation_answers: [],
    syntax_analysis: [],
    theme_answer: '',
    summary: { text: '', ans: '' },
    title_examples: [],
    comprehensive: [],
  };
}
