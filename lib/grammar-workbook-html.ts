/**
 * 어법공략 워크북 — 3 유형 HTML 빌더 (양자택일 / 어법 오류 수정 / O·X).
 *
 *   G. 양자택일       — 원문 한 자리를 `[ formA / formB ]` 로 노출, 학생이 정답 선택
 *   H. 어법 오류 수정 — `correct`→`wrong` 으로 치환한 지문에 ①②③ 번호 (오답 아닌 함정도 포함),
 *                      학생이 오류 찾고 고쳐 쓰기
 *   J. O·X 채점       — 보기 여러 개에 O/X 판정 + 틀린 것 고쳐 쓰기
 *
 * 정답지(answer key) 에는 각 포인트/구간/보기마다 「어법 설명」 카드를 노출 — 학생이 왜 그게 답인지 이해.
 *
 * 출력은 인쇄·Word 친화적인 단일 HTML. 미리보기는 srcDoc, 내보내기는 `.doc` Blob.
 */

import type { SelectionBlock, SentenceTokenized } from './block-workbook-types';

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function joinTokens(tokens: string[]): string {
  return tokens.join(' ').replace(/\s+([,.;:!?])/g, '$1');
}

/** 포인트 번호별 색상 팔레트 (해석 강조 + # 번호 동일 색). */
const KO_MARK_PALETTE: { fg: string; bg: string }[] = [
  { fg: '#1d4ed8', bg: '#dbeafe' }, // 1 파랑
  { fg: '#047857', bg: '#d1fae5' }, // 2 초록
  { fg: '#b45309', bg: '#fef3c7' }, // 3 주황
  { fg: '#6d28d9', bg: '#ede9fe' }, // 4 보라
  { fg: '#be123c', bg: '#ffe4e6' }, // 5 분홍
  { fg: '#0f766e', bg: '#ccfbf1' }, // 6 청록
];
function koMarkColor(num: number): { fg: string; bg: string } {
  return KO_MARK_PALETTE[(num - 1) % KO_MARK_PALETTE.length];
}

/**
 * 한 문장의 해석(한국어)에 여러 포인트의 대응 부분을 **각기 다른 색 + 번호**로 강조.
 * marks = [{ num, koCorrect }]. koCorrect 가 해석에 있는 것만 표시(겹치면 앞선 것 우선).
 */
function multiHighlightKo(ko: string, marks: { num: number; koCorrect?: string }[]): string {
  const esc = escapeHtml(ko);
  // 각 mark 의 위치 탐색
  const ranges: { start: number; end: number; num: number }[] = [];
  for (const m of marks) {
    const t = (m.koCorrect ?? '').trim();
    if (!t) continue;
    const escT = escapeHtml(t);
    let from = 0;
    // 이미 점유되지 않은 첫 위치를 찾음
    while (from <= esc.length) {
      const idx = esc.indexOf(escT, from);
      if (idx < 0) break;
      const overlaps = ranges.some(r => idx < r.end && idx + escT.length > r.start);
      if (!overlaps) { ranges.push({ start: idx, end: idx + escT.length, num: m.num }); break; }
      from = idx + 1;
    }
  }
  if (ranges.length === 0) return esc;
  ranges.sort((a, b) => a.start - b.start);
  let out = '';
  let cur = 0;
  for (const r of ranges) {
    if (r.start < cur) continue;
    const c = koMarkColor(r.num);
    out += esc.slice(cur, r.start);
    out += `<span class="gw-anal-ko-mark" style="color:${c.fg};background:${c.bg}"><sup class="gw-anal-ko-num">${r.num}</sup>${esc.slice(r.start, r.end)}</span>`;
    cur = r.end;
  }
  out += esc.slice(cur);
  return out;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function circleMark(i: number): string {
  if (i < CIRCLED.length) return CIRCLED[i];
  return `〔${i + 1}〕`;
}

const WORD_META = `<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="ProgId" content="Word.Document"><meta name="Generator" content="Microsoft Word"><meta name="Originator" content="Microsoft Word"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->`;

const SHARED_CSS = `
  .gw-section-head, .gw-section-head .gw-tag,
  .gw-q-bar, .gw-q-tag, .gw-q-points,
  .gw-answer-header, .gw-answer-card .ac-head, .gw-anal-type,
  .gw-passage, .gw-pick, .gw-lemma, .gw-circle, .gw-warning, .gw-bogi,
  .gw-ox-item, .gw-ox-key, .gw-explain,
  .gw-anal-table thead th, .gw-anal-ko-mark, .gw-anal-ko-row td {
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
  /* === 상단 헤더 (서술형 출제기 양식) === */
  .gw-header {
    border-bottom: 2pt solid #111;
    padding-bottom: 4pt;
    margin-bottom: 8pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-h-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12pt;
  }
  .gw-header .gw-h-title {
    font-size: 15pt;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.5pt;
    white-space: nowrap;
  }
  .gw-header .gw-h-sub {
    font-size: 9.5pt;
    color: #555;
    text-align: right;
  }
  .gw-header .gw-h-meta {
    margin-top: 3pt;
    font-size: 9pt;
    color: #444;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    column-gap: 14pt;
    row-gap: 6pt;
  }
  .gw-meta-item {
    display: inline-flex;
    align-items: flex-end;
    gap: 6pt;
    white-space: nowrap;
  }
  .gw-meta-item b {
    color: #111;
    font-weight: 700;
  }
  .gw-meta-val {
    display: inline-block;
    min-width: 70pt;
    min-height: 12pt;
    padding: 0 6pt 2pt;
    border-bottom: 0.7pt solid #333;
    box-sizing: content-box;
  }
  .gw-meta-school .gw-meta-val { min-width: 80pt; }
  .gw-meta-grade .gw-meta-val { min-width: 24pt; }
  .gw-meta-name .gw-meta-val { min-width: 90pt; }
  /* 출처는 작성란 아닌 정보 표기 — 밑줄 없음 */
  .gw-meta-src .gw-meta-val {
    border-bottom: none;
    min-width: auto;
    padding: 0;
    color: #555;
  }
  .gw-q-bar {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin: 8pt 0 5pt;
    padding: 4pt 10pt;
    background: #111;
    color: #fff;
    border-radius: 2pt;
    /* 제목 바가 페이지 끝에 orphan 으로 남지 않도록 — 다음 콘텐츠와 함께 다음 페이지로 */
    page-break-after: avoid;
    break-after: avoid;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  /* 제목 바 + 안내문 + 지문 박스를 가능한 한 묶어 출력 */
  .gw-instruction {
    page-break-before: avoid;
    break-before: avoid;
  }
  .gw-passage {
    page-break-before: avoid;
    break-before: avoid;
  }
  .gw-q-tag {
    background: #fff;
    color: #111;
    padding: 1pt 7pt;
    border-radius: 2pt;
    font-size: 9pt;
    font-weight: 800;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-q-title {
    flex: 1;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 11pt;
    font-weight: 600;
    letter-spacing: -0.3pt;
  }
  .gw-q-points {
    background: #fde68a;
    color: #92400e;
    padding: 1pt 6pt;
    border-radius: 2pt;
    font-size: 9pt;
    font-weight: 700;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-section { margin-top: 10pt; }
  .gw-section-head {
    background: #111;
    color: #fff;
    padding: 4pt 10pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 11pt;
    font-weight: 600;
    margin: 0 0 6pt 0;
    letter-spacing: -0.3pt;
  }
  .gw-section-head .gw-tag {
    background: #fff;
    color: #111;
    padding: 1pt 5pt;
    border-radius: 2pt;
    font-size: 8.5pt;
    margin-right: 7pt;
    font-weight: 700;
  }
  .gw-instruction {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9.5pt;
    color: #444;
    margin: 0 0 5pt 0;
  }
  .gw-meta {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
    color: #555;
  }
  .gw-passage {
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 10.5pt;
    line-height: 1.85;
    text-align: justify;
    padding: 8pt 12pt;
    border: 0.7pt solid #999;
    background: #fafafa;
    white-space: pre-wrap;
  }
  /* G — 양자택일 [ a / b ] */
  .gw-pick {
    display: inline-block;
    padding: 0 4px;
    margin: 0 1px;
    color: #1e3a8a;
    background: #eef4ff;
    border: 0.5pt solid #6f8fc4;
    border-radius: 2pt;
    font-weight: 600;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-pick .sep { color: #6f8fc4; padding: 0 2px; font-weight: 400; }
  /* F — 어형 변환 (baseForm 괄호) */
  .gw-lemma {
    display: inline-block;
    padding: 0 4px;
    color: #1e3a8a;
    background: #eef4ff;
    border: 0.4pt dashed #6f8fc4;
    border-radius: 2pt;
    font-style: italic;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-lemma-empty { color: #b45309; background: #fffbeb; border-color: #d97706; }
  /* H — 동그라미 번호 + 오답 치환 */
  .gw-circle {
    display: inline-block;
    color: #b91c1c;
    font-weight: 800;
    font-size: 10pt;
    margin-right: 1px;
  }
  .gw-wrong-form {
    color: #111;
    background: #fff;
    text-decoration: none;
  }
  /* 답란 (양자택일·오류수정·O/X 공통) — 컴팩트 */
  .gw-write-block {
    margin-top: 5pt;
    padding: 2pt 6pt;
    border: 0.5pt solid #999;
    background: #fafafa;
  }
  .gw-write-row {
    display: flex;
    align-items: baseline;
    gap: 6pt;
    padding: 1pt 0;
    border-bottom: 0.4pt dashed #ccc;
    line-height: 1.2;
  }
  .gw-write-row:last-child { border-bottom: 0; }
  .gw-write-row .gw-num {
    flex-shrink: 0;
    font-weight: 700;
    min-width: 16pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-write-row .gw-snippet {
    flex-shrink: 0;
    font-family: 'Times New Roman', serif;
    color: #444;
  }
  .gw-write-row .gw-line {
    flex: 1;
    border-bottom: 0.6pt solid #555;
    height: 10pt;
  }
  .gw-write-row .gw-ox-buttons {
    flex-shrink: 0;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 700;
  }
  .gw-write-row .gw-ox-buttons span {
    display: inline-block;
    min-width: 18pt;
    text-align: center;
    border: 0.5pt solid #555;
    border-radius: 50%;
    padding: 0 6pt;
    margin-right: 3pt;
  }
  /* O/X 보기 카드 (구형 — 호환 유지) */
  .gw-ox-item {
    margin-top: 6pt;
    padding: 5pt 10pt;
    border: 0.5pt solid #aaa;
    background: #fff;
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 10.5pt;
    line-height: 1.7;
  }
  .gw-ox-item .gw-circle { margin-right: 4px; }
  /* O/X 통합 행 (신규) — [번호] [문장] [O/X] [고쳐쓰기→___] */
  .gw-ox-list {
    margin-top: 5pt;
    border: 0.5pt solid #999;
    background: #fafafa;
    padding: 2pt 6pt;
  }
  .gw-ox-row {
    display: flex;
    align-items: baseline;
    gap: 6pt;
    padding: 3pt 0;
    border-bottom: 0.4pt dashed #ccc;
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 10.5pt;
    line-height: 1.35;
  }
  .gw-ox-row:last-child { border-bottom: 0; }
  .gw-ox-row .gw-ox-num {
    flex-shrink: 0;
    font-weight: 700;
    min-width: 14pt;
    color: #111;
  }
  .gw-ox-row .gw-ox-sent {
    flex: 1 1 auto;
    min-width: 40%;
  }
  .gw-ox-row .gw-ox-buttons {
    flex-shrink: 0;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 700;
  }
  .gw-ox-row .gw-ox-buttons span {
    display: inline-block;
    min-width: 16pt;
    text-align: center;
    border: 0.5pt solid #555;
    border-radius: 50%;
    padding: 0 6pt;
    margin-right: 3pt;
  }
  .gw-ox-row .gw-ox-fix {
    flex: 1 1 36%;
    min-width: 100pt;
    display: flex;
    align-items: baseline;
    gap: 3pt;
    color: #555;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
  }
  .gw-ox-row .gw-ox-fix .gw-line {
    flex: 1;
    border-bottom: 0.6pt solid #555;
    height: 10pt;
  }
  /* 정답지 — 다이어트 버전 (공간 효율) */
  /* === 정답 및 해설 === */
  .gw-answer-key { margin-top: 8pt; }
  .gw-answer-header {
    background: #222;
    color: #fff;
    padding: 3pt 8pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    margin: 0 0 4pt 0;
    page-break-after: avoid;
    display: flex;
    align-items: baseline;
    gap: 8pt;
  }
  .gw-answer-header .gw-ak-title {
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: -0.3pt;
  }
  .gw-answer-header .gw-ak-sub {
    font-size: 8.5pt;
    opacity: 0.85;
    margin-top: 0;
  }
  /* 정답 블록 — 헤더 + 어법 설명을 한 박스로 통합 (회색 박스 1중) */
  .gw-answer-card {
    margin-bottom: 3pt;
    page-break-inside: avoid;
    border-left: 2pt solid #111;
    background: #f8f8f8;
  }
  .gw-answer-card .ac-head {
    padding: 2pt 8pt;
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 9.8pt;
    line-height: 1.3;
    color: #111;
  }
  .gw-answer-card .ac-head .lab {
    color: #111;
    font-weight: 800;
    margin-right: 5px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-answer-card .ac-head .arrow {
    color: #6b7280;
    margin: 0 5px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-answer-card .ac-head .ok { color: #047857; font-weight: 700; }
  .gw-answer-card .ac-head .ng { color: #b91c1c; font-weight: 700; }
  .gw-answer-card .ac-head .gtype {
    display: inline-block;
    margin-right: 5px;
    padding: 0 4pt;
    background: #eef2ff;
    color: #1e3a8a;
    border-radius: 2pt;
    font-size: 7.8pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 700;
  }
  .gw-answer-card .ac-head .pos {
    display: inline-block;
    margin-left: 5px;
    padding: 0 4pt;
    background: #fff7ed;
    color: #9a3412;
    border-radius: 2pt;
    font-size: 8pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-weight: 700;
  }
  /* 어법 설명 — 박스 내부에서 ac-head 아래에 자연스럽게 이어짐 (이중 박스 제거) */
  .gw-explain {
    margin: 0;
    padding: 2pt 8pt 3pt;
    background: transparent;
    border: 0;
    border-top: 0.4pt dotted #d1d5db;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
    color: #1f2937;
    line-height: 1.4;
  }
  .gw-explain .lab {
    display: inline-block;
    color: #6b7280;
    font-weight: 700;
    margin-right: 4px;
    font-size: 8pt;
    letter-spacing: -0.2pt;
  }
  .gw-explain-missing {
    display: inline-block;
    color: #9ca3af;
    font-style: italic;
    font-size: 8.5pt;
  }
  .gw-warning {
    margin: 6pt 0;
    padding: 4pt 8pt;
    background: #fef3c7;
    border-left: 2.5pt solid #d97706;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 9pt;
    color: #92400e;
  }
  /* === 어법 포인트 분석지 (학생 배부용) — 한 페이지에 빽빽이 === */
  .gw-section-P { margin-top: 5pt; }
  .gw-section-P .gw-q-bar { margin: 4pt 0 4pt; padding: 3pt 10pt; }
  .gw-section-P .gw-instruction { margin: 0 0 4pt 0; font-size: 8.8pt; line-height: 1.35; }
  .gw-anal-passage {
    line-height: 2.05;
    padding: 6pt 10pt;
    margin-bottom: 0;
    font-size: 10pt;
  }
  /* 정답(위·밑줄) + 함정(아래·옅은 취소선) 세로 묶음 */
  .gw-anal-passage .pt-stack {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    line-height: 1.0;
  }
  .gw-anal-passage .pt {
    border-bottom: 1.2pt solid #1e3a8a;
    font-weight: 600;
    color: #1e3a8a;
    padding: 0 1px;
  }
  .gw-anal-passage .pt-wrong {
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 8pt;
    color: #b91c1c;
    text-decoration: line-through;
    text-decoration-color: rgba(185, 28, 28, 0.45);
    margin-top: 0.5pt;
  }
  .gw-anal-passage .pt-num {
    display: inline-block;
    color: #b91c1c;
    font-weight: 800;
    font-size: 8.5pt;
    vertical-align: super;
    margin-right: 1px;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  /* 어법 포인트 정리 표 (서술형 출제기 정답지 양식) */
  .gw-anal-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6pt;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 8.8pt;
  }
  .gw-anal-table th, .gw-anal-table td {
    border: 0.4pt solid #666;
    padding: 2.2pt 5pt;
    vertical-align: top;
    text-align: left;
    line-height: 1.3;
  }
  .gw-anal-table thead th {
    background: #111;
    color: #fff;
    font-weight: 600;
    text-align: center;
    font-size: 8.5pt;
  }
  .gw-anal-table .c-num { width: 4%; text-align: center; color: #b91c1c; font-weight: 800; }
  .gw-anal-table .c-type { width: 10%; text-align: center; }
  .gw-anal-table .c-correct { width: 11%; }
  .gw-anal-table .c-wrong { width: 11%; }
  .gw-anal-table .c-expl { width: 64%; }
  .gw-anal-type {
    display: inline-block;
    background: #eef2ff;
    color: #1e3a8a;
    border: 0.4pt solid #c7d2fe;
    padding: 0.5pt 5pt;
    border-radius: 2pt;
    font-size: 8pt;
    font-weight: 700;
    font-family: 'Noto Sans CJK KR', sans-serif;
  }
  .gw-anal-correct {
    font-family: 'Times New Roman', 'Noto Serif CJK KR', serif;
    font-size: 9.5pt;
    font-weight: 700;
    color: #047857;
  }
  .gw-anal-wrong {
    font-family: 'Times New Roman', serif;
    font-size: 9pt;
    color: #b91c1c;
    text-decoration: line-through;
  }
  .gw-anal-expl {
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 8.8pt;
    color: #1f2937;
    line-height: 1.4;
  }
  .gw-anal-ko {
    display: block;
    font-size: 8.3pt;
    color: #6b7280;
    margin-top: 1pt;
  }
  /* 해석 전용 행 (포인트들 아래 colspan 한 줄) */
  .gw-anal-ko-row td {
    background: #f8fafc;
    font-family: 'Noto Sans CJK KR', sans-serif;
    font-size: 8.6pt;
    color: #475569;
    line-height: 1.45;
    border-top: 0.4pt dashed #cbd5e1;
  }
  .gw-anal-ko-label {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 800;
    color: #64748b;
    background: #e2e8f0;
    border-radius: 2pt;
    padding: 0 4pt;
    margin-right: 5pt;
    vertical-align: 1pt;
  }
  /* 해석 중 정답 대응 부분 강조 — 색은 포인트 번호별로 inline */
  .gw-anal-ko-mark {
    font-weight: 700;
    border-radius: 2pt;
    padding: 0 1.5pt;
  }
  .gw-anal-ko-num {
    font-size: 0.7em;
    font-weight: 800;
    vertical-align: super;
    margin-right: 0.5pt;
  }
  @page { size: A4; margin: 12mm 13mm 11mm 13mm; }
  @media print {
    body { padding: 0; max-width: none; }
    .gw-section + .gw-answer-key { page-break-before: always; }
    .gw-anal-table tr { page-break-inside: avoid; }
    .gw-anal-table thead { display: table-header-group; }
  }
`;

function htmlShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${WORD_META}<title>${escapeHtml(title)}</title><style>${SHARED_CSS}</style></head><body>
${body}
</body></html>`;
}

// ── 공통 헤더 / 문항 바 ───────────────────────────────────────────────────────

export interface ExamMeta {
  /** 시험지 제목 (예: 영어 어법공략 평가). */
  examTitle?: string;
  /** 학교명. */
  schoolName?: string;
  /** 학년. */
  grade?: string;
  /** 시험지 부제 (예: 2026학년도 3월 모의). */
  examSubtitle?: string;
  /** 문항 번호 (예: 02번, 어법공략). */
  questionNumber?: string;
  /** @deprecated 워크북은 배점을 쓰지 않음. 옛 데이터 호환을 위해 타입만 유지 (렌더링 안 함). */
  totalPoints?: number | string;
}

interface HeaderParts extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
}

function header(opts: HeaderParts, hideTitleRow = false): string {
  const tb = (opts.textbook || '').trim();
  let sk = (opts.sourceKey || '').trim();
  if (tb && sk.startsWith(tb)) sk = sk.slice(tb.length).trim();
  const examTitle = (opts.examTitle || '').trim();
  const examSubtitle = (opts.examSubtitle || '').trim();
  const school = (opts.schoolName || '').trim();
  const grade = (opts.grade || '').trim();
  const titleLine = examTitle || opts.title;
  const source = [tb, sk].filter(Boolean).join(' · ');

  // 학교·학년·성명: 작성란(밑줄). 값이 있으면 채워서, 없으면 빈 칸.
  // 성명은 학생이 직접 쓰도록 항상 빈 칸. 출처는 밑줄 없는 정보 표기.
  const metaItems = [
    `<span class="gw-meta-item gw-meta-school"><b>학교</b><span class="gw-meta-val">${escapeHtml(school) || ' '}</span></span>`,
    `<span class="gw-meta-item gw-meta-grade"><b>학년</b><span class="gw-meta-val">${escapeHtml(grade) || ' '}</span></span>`,
    `<span class="gw-meta-item gw-meta-name"><b>성명</b><span class="gw-meta-val"> </span></span>`,
    ...(source ? [`<span class="gw-meta-item gw-meta-src"><b>출처</b><span class="gw-meta-val">${escapeHtml(source)}</span></span>`] : []),
  ].join('\n    ');

  // hideTitleRow=true 면 시험지 제목·부제 줄을 생략하고 메타(학교/학년/성명/출처) 만 (분석지용).
  const titleRow = hideTitleRow
    ? ''
    : `<div class="gw-h-row">
    <div class="gw-h-title">${escapeHtml(titleLine)}</div>
    ${examSubtitle ? `<div class="gw-h-sub">${escapeHtml(examSubtitle)}</div>` : ''}
  </div>`;

  return `<header class="gw-header">
  ${titleRow}
  <div class="gw-h-meta">
    ${metaItems}
  </div>
</header>`;
}

function questionBar(modeTag: string, modeLabel: string, opts: ExamMeta): string {
  const qn = (opts.questionNumber || '').trim();
  const left = qn ? `<span class="gw-q-tag">${escapeHtml(qn)}</span>` : `<span class="gw-q-tag">${escapeHtml(modeTag)}</span>`;
  // 워크북은 배점이 의미 없으므로 표시하지 않음
  return `<div class="gw-q-bar">
  ${left}
  <span class="gw-q-title">${escapeHtml(modeLabel)}</span>
</div>`;
}

/**
 * 정답 및 해설 헤더 — 서술형 출제기 정답지 양식 (검은 바 + 제목 + 영문 부제).
 * sub: "Answer Key & Explanation · 출처 · 모드 라벨"
 */
function answerKeyHeader(modeLabel: string, sourceKey: string): string {
  const sk = (sourceKey || '').trim();
  const subParts = [sk, modeLabel].filter(Boolean);
  return `<div class="gw-answer-header">
  <div class="gw-ak-title">정답 및 해설</div>
  <div class="gw-ak-sub">${escapeHtml(subParts.join(' · '))}</div>
</div>`;
}

function explainBlock(explanation?: string): string {
  const t = (explanation ?? '').trim();
  if (!t) {
    return `<div class="gw-explain"><span class="lab">어법 설명</span><span class="gw-explain-missing">(미입력)</span></div>`;
  }
  // 줄바꿈 보존
  const html = escapeHtml(t).replace(/\n/g, '<br>');
  return `<div class="gw-explain"><span class="lab">어법 설명</span>${html}</div>`;
}

// ── P. 어법 포인트 (primary input — 1차 추출, G·H·J 모드의 source) ──────────────

/**
 * 기본 문법 유형 8가지 — 「지금필수 고난도유형」 엑셀에서 사용하던 분류.
 * grammarType 필드는 string 이라 자유 확장 가능 (예: '도치', '강조', '가정법' …).
 */
export const DEFAULT_GRAMMAR_TYPES = [
  '수일치',
  '전치사',
  '시제',
  '수동태',
  '관계사',
  '접속사',
  '분사',
  '부정사',
] as const;

export type DefaultGrammarType = typeof DEFAULT_GRAMMAR_TYPES[number];

/**
 * 한 지문에서 추출한 어법 포인트 1개.
 * 같은 포인트가 F(어형변환)·G(양자택일)·H(오류수정)·J(O·X) 4 모드의 source 가 된다.
 *
 * F 변환 조건: 단일 토큰 (endTokenIdx === startTokenIdx) + baseForm 입력. 그 외 모드는 모든 포인트에서 가능.
 */
export interface GrammarPoint {
  /** 클라이언트 고유 ID (UI 토글·삭제용). 직렬화도 됨. */
  id: string;
  sentenceIdx: number;
  startTokenIdx: number;
  endTokenIdx: number;
  /** 원문에 들어 있는 정답 표현 (토큰 join 으로 자동 채워도 됨). */
  correctForm: string;
  /** 함정 후보들 (1~3개 권장). 첫 번째가 모드 변환 시 기본 wrong 으로 사용. */
  wrongCandidates: string[];
  /** 문법 유형 — DEFAULT_GRAMMAR_TYPES 의 8가지 또는 자유 입력. */
  grammarType: string;
  /** 정답지 어법 설명 — 학생이 왜 답인지 이해. F·G·H·J 모두 공유. */
  explanation: string;
  /** 정답 표현에 대응하는 한국어 부분 (분석지 해석에서 색칠 표시용). 예: correctForm 'express' → koCorrect '표현한다'. */
  koCorrect?: string;
  /** AI 추출 신뢰도 (0~10). 사용자 수동 작성이면 비워둠. */
  confidenceScore?: number;
  /** 이 포인트를 어느 모드(들) 에 사용할지. 동기화 함수가 참조. 기본 ['G','H','J']. F 는 baseForm 있을 때만 의미. */
  uses: ('F' | 'G' | 'H' | 'J')[];
  /** F 모드용 lemma (원형). 단일 토큰 포인트에서만 의미. uses 에 'F' 가 있을 때 동기화. */
  baseForm?: string;
  /** H 모드 역할 — 'error'=실제 오류(지문에 wrongForm 치환), 'decoy'=함정(번호만). 기본 'error'. */
  hRole?: 'error' | 'decoy';
  /** J 모드 변형 — 'wrong'=오답 형태로 보기(X 정답), 'correct'=원문 그대로(O 정답). 기본 'wrong'. */
  jVariant?: 'wrong' | 'correct';
}

/**
 * 포인트 풀 → F(어형변환) word 블록 배열.
 * 조건: 단일 토큰 (endTokenIdx === startTokenIdx) + uses 에 'F' + baseForm 있음.
 */
export function pointsToTransform(points: GrammarPoint[]): SelectionBlock[] {
  return points
    .filter(p => p.uses.includes('F') && p.endTokenIdx === p.startTokenIdx && (p.baseForm ?? '').trim())
    .map(p => ({
      sentenceIdx: p.sentenceIdx,
      startTokenIdx: p.startTokenIdx,
      endTokenIdx: p.endTokenIdx,
      kind: 'word' as const,
      baseForm: (p.baseForm ?? '').trim(),
    }));
}

/** 포인트 풀 → G(양자택일) 포인트 배열. */
export function pointsToEitherOr(points: GrammarPoint[]): EitherOrPoint[] {
  return points
    .filter(p => p.uses.includes('G'))
    .map(p => ({
      sentenceIdx: p.sentenceIdx,
      startTokenIdx: p.startTokenIdx,
      endTokenIdx: p.endTokenIdx,
      correctForm: p.correctForm,
      wrongForm: (p.wrongCandidates[0] ?? '').trim(),
      explanation: p.explanation,
    }));
}

/** 포인트 풀 → H(오류수정) spans. hRole 에 따라 isError 결정. */
export function pointsToCorrection(points: GrammarPoint[]): CorrectionSpan[] {
  return points
    .filter(p => p.uses.includes('H'))
    .map(p => {
      const isError = (p.hRole ?? 'error') === 'error';
      const wrong = (p.wrongCandidates[0] ?? '').trim();
      return {
        sentenceIdx: p.sentenceIdx,
        startTokenIdx: p.startTokenIdx,
        endTokenIdx: p.endTokenIdx,
        isError,
        ...(isError ? { wrongForm: wrong, correction: p.correctForm, explanation: p.explanation } : {}),
      } satisfies CorrectionSpan;
    });
}

/** 포인트 풀 → J(O·X) 보기 배열. jVariant 에 따라 correct/wrong 분기. */
export function pointsToOx(
  points: GrammarPoint[],
  sentences: SentenceTokenized[],
): OxItem[] {
  const out: OxItem[] = [];
  for (const p of points) {
    if (!p.uses.includes('J')) continue;
    const sent = sentences.find(s => s.idx === p.sentenceIdx);
    if (!sent) continue;
    const useWrong = (p.jVariant ?? 'wrong') === 'wrong';
    const wrong = (p.wrongCandidates[0] ?? '').trim();
    if (useWrong && !wrong) {
      // wrong 후보 없으면 correct 로 fallback
      out.push({
        text: sent.text,
        isCorrect: true,
        explanation: p.explanation,
      });
      continue;
    }
    if (useWrong) {
      // 토큰 일부를 wrong 으로 치환
      const wrongTokens = wrong.split(/\s+/);
      const tokens = [...sent.tokens];
      tokens.splice(p.startTokenIdx, p.endTokenIdx - p.startTokenIdx + 1, ...wrongTokens);
      out.push({
        text: tokens.join(' '),
        isCorrect: false,
        correction: sent.text,
        explanation: p.explanation,
      });
    } else {
      out.push({
        text: sent.text,
        isCorrect: true,
        explanation: p.explanation,
      });
    }
  }
  return out;
}

type GrammarModeKey = 'F' | 'G' | 'H' | 'J';

/** 포인트가 해당 모드에 쓰일 수 있는지 (capability). F 는 단일 토큰 + baseForm 필요. */
function pointCapableOf(p: GrammarPoint, mode: GrammarModeKey): boolean {
  if (!p.uses.includes(mode)) return false;
  if (mode === 'F') return p.endTokenIdx === p.startTokenIdx && !!(p.baseForm ?? '').trim();
  return true;
}

/**
 * 문장당 2~3개의 포인트 풀을 F·G·H·J 에 **분배**.
 *  - 각 모드는 한 문장에서 최대 1개의 포인트만 사용.
 *  - 같은 문장 안에서는 모드끼리 가능한 한 **서로 다른** 포인트를 쓰도록 배치
 *    (→ 유형마다 다른 문제 = 학습 효과). 포인트가 모드 수보다 적으면 일부 공유.
 *  - 제약이 가장 큰 F 부터 배정.
 *
 * 반환: 모드별로 (문장당 ≤1개) 선택된 포인트 배열.
 */
export function distributePointsByMode(
  points: GrammarPoint[],
): Record<GrammarModeKey, GrammarPoint[]> {
  const out: Record<GrammarModeKey, GrammarPoint[]> = { F: [], G: [], H: [], J: [] };
  const order: GrammarModeKey[] = ['F', 'G', 'H', 'J'];

  // 문장별 그룹 (토큰 순 정렬)
  const bySentence = new Map<number, GrammarPoint[]>();
  for (const p of points) {
    const arr = bySentence.get(p.sentenceIdx) ?? [];
    arr.push(p);
    bySentence.set(p.sentenceIdx, arr);
  }

  for (const [, ptsRaw] of bySentence) {
    const pts = [...ptsRaw].sort((a, b) => a.startTokenIdx - b.startTokenIdx);
    const used = new Set<string>();
    for (const mode of order) {
      const elig = pts.filter(p => pointCapableOf(p, mode));
      if (elig.length === 0) continue;
      const pick = elig.find(p => !used.has(p.id)) ?? elig[0];
      used.add(pick.id);
      out[mode].push(pick);
    }
  }
  return out;
}

/**
 * 한 번 호출로 F·G·H·J 4 모드 데이터 모두 생성.
 * 문장당 2~3개의 포인트를 모드별로 1개씩 분배해, 유형마다 서로 다른 문항이 되도록 한다.
 */
export function syncPointsToModes(
  points: GrammarPoint[],
  sentences: SentenceTokenized[],
): {
  transformBlocks: SelectionBlock[];
  eitherOrPoints: EitherOrPoint[];
  correctionSpans: CorrectionSpan[];
  oxItems: OxItem[];
} {
  const dist = distributePointsByMode(points);
  return {
    transformBlocks: pointsToTransform(dist.F),
    eitherOrPoints: pointsToEitherOr(dist.G),
    correctionSpans: pointsToCorrection(dist.H),
    oxItems: pointsToOx(dist.J, sentences),
  };
}

// ── P. 어법 포인트 분석지 (학생 배부용 교재 형식) ──────────────────────────────

export interface BuildPointsAnalysisOptions extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
  sentences: SentenceTokenized[];
  points: GrammarPoint[];
}

/**
 * 어법 포인트 분석지 — 지문에 포인트를 밑줄+위첨자 번호로 표시하고,
 * 하단에 번호별 [유형] 정답 · 어법 설명 · 함정을 정리한 학생 배부용 교재.
 */
export function buildPointsAnalysisHtml(opts: BuildPointsAnalysisOptions): string {
  const sorted = [...opts.points].sort((a, b) => {
    if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
    return a.startTokenIdx - b.startTokenIdx;
  });

  // 포인트에 1-base 번호 부여
  const numbered = sorted.map((p, i) => ({ point: p, num: i + 1 }));

  // 지문 렌더 — 포인트 위치에 밑줄 + 위첨자 번호
  const sentenceHtmls = opts.sentences.map(s => {
    const here = numbered.filter(n => n.point.sentenceIdx === s.idx);
    if (here.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const hit = here.find(n => n.point.startTokenIdx === i);
      if (hit) {
        const phrase = joinTokens(s.tokens.slice(hit.point.startTokenIdx, hit.point.endTokenIdx + 1));
        const wrong = (hit.point.wrongCandidates?.[0] ?? '').trim();
        // 정답(밑줄) 위, 함정(오답·옅은 취소선) 아래로 쌓아 보여줌
        const stackInner = `<span class="pt">${escapeHtml(phrase)}</span>${wrong ? `<span class="pt-wrong">${escapeHtml(wrong)}</span>` : ''}`;
        out.push(`<span class="pt-num">${hit.num}</span><span class="pt-stack">${stackInner}</span>`);
        i = hit.point.endTokenIdx + 1;
        continue;
      }
      const inMid = here.some(n => i > n.point.startTokenIdx && i <= n.point.endTokenIdx);
      if (!inMid) out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });
  const body = sentenceHtmls.join(' ');

  // 하단 번호별 정리 표 (서술형 출제기 정답지 양식)
  // 문장 단위로 묶어: 포인트 행들(어법 설명만) 다음에, 그 문장의 해석을 colspan 한 줄로 한 번만.
  // 해석 안에서는 포인트별 색+번호로 강조 → 어느 행과 연결되는지 명확.
  const sentOrder = [...new Set(numbered.map(n => n.point.sentenceIdx))];
  const rowsHtml: string[] = [];
  for (const sIdx of sentOrder) {
    const items = numbered.filter(n => n.point.sentenceIdx === sIdx);
    const sent = opts.sentences.find(s => s.idx === sIdx);
    for (const { point: p, num } of items) {
      const correct = (p.correctForm || '').trim()
        || (sent ? joinTokens(sent.tokens.slice(p.startTokenIdx, p.endTokenIdx + 1)) : '');
      const wrongs = (p.wrongCandidates || []).map(w => (w ?? '').trim()).filter(Boolean);
      const type = (p.grammarType || '').trim();
      const expl = (p.explanation || '').trim();
      const numColor = koMarkColor(num).fg;
      const wrongCell = wrongs.length
        ? wrongs.map(w => `<span class="gw-anal-wrong">${escapeHtml(w)}</span>`).join(', ')
        : '<span style="color:#9ca3af">—</span>';
      const explCell = expl
        ? `<span class="gw-anal-expl">${escapeHtml(expl).replace(/\n/g, '<br>')}</span>`
        : '<span style="color:#9ca3af">—</span>';
      rowsHtml.push(`<tr>
  <td class="c-num" style="color:${numColor}">${num}</td>
  <td class="c-type">${type ? `<span class="gw-anal-type">${escapeHtml(type)}</span>` : '—'}</td>
  <td class="c-correct"><span class="gw-anal-correct">${escapeHtml(correct)}</span></td>
  <td class="c-wrong">${wrongCell}</td>
  <td class="c-expl">${explCell}</td>
</tr>`);
    }
    // 문장 해석 — 포인트 행들 바로 아래 전체 너비 한 줄
    const ko = (sent?.korean ?? '').trim();
    if (ko) {
      const marks = items.map(n => ({ num: n.num, koCorrect: n.point.koCorrect }));
      rowsHtml.push(`<tr class="gw-anal-ko-row"><td colspan="5"><span class="gw-anal-ko-label">해석</span> ${multiHighlightKo(ko, marks)}</td></tr>`);
    }
  }
  const rows = rowsHtml.join('\n');

  const tableHtml = numbered.length
    ? `<table class="gw-anal-table">
  <thead>
    <tr><th class="c-num">#</th><th class="c-type">유형</th><th class="c-correct">정답</th><th class="c-wrong">함정(오답)</th><th class="c-expl">어법 설명</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`
    : '<div class="gw-meta">아직 어법 포인트가 없습니다. 좌측에서 토큰을 클릭해 포인트를 추가하세요.</div>';

  const main = `<section class="gw-section gw-section-P">
${questionBar('✦', '어법 포인트 분석', opts)}
<div class="gw-instruction">▸ 지문의 밑줄 친 어법 포인트와 아래 표의 해설을 학습하세요. 각 포인트의 정답 형태와 함정(오답)을 함께 익힙니다.</div>
<div class="gw-passage gw-anal-passage">${body}</div>
${tableHtml}
</section>`;

  // 분석지는 시험지 제목·부제 생략 (학교/학년/성명/출처 메타만)
  return htmlShell(`${opts.title} — 어법 포인트 분석`, `${header(opts, true)}
${main}`);
}

// ── F. 어형 변환 (grammar 양식 — gw 헤더/문항바 통일) ──────────────────────────

export interface BuildTransformOptions extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
  sentences: SentenceTokenized[];
  /** word 블록 (baseForm 포함). uses 미설정/빈 배열은 백워드 호환으로 포함, 설정 시 'F' 명시될 때만. */
  blocks: SelectionBlock[];
}

/**
 * F 어형 변환 — 단어 자리에 baseForm 을 `(reveal)` 괄호로 노출, 학생이 문맥 어형으로 변환.
 * block-workbook 의 buildGrammarTransformHtml 과 동일 동작이나, 다른 모드와 통일된 gw 헤더/문항바 사용.
 */
export function buildTransformHtml(opts: BuildTransformOptions): string {
  const wordBlocks = opts.blocks
    .filter(b => {
      if (b.kind !== 'word') return false;
      if (!b.uses || b.uses.length === 0) return true;
      return b.uses.includes('F');
    })
    .sort((a, b) => (a.sentenceIdx !== b.sentenceIdx ? a.sentenceIdx - b.sentenceIdx : a.startTokenIdx - b.startTokenIdx));
  let missing = 0;

  const sentenceHtmls = opts.sentences.map(s => {
    const here = wordBlocks
      .filter(b => b.sentenceIdx === s.idx)
      .sort((a, b) => a.startTokenIdx - b.startTokenIdx);
    if (here.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const block = here.find(b => b.startTokenIdx === i);
      if (block) {
        const lemma = (block.baseForm ?? '').trim();
        if (!lemma) missing += 1;
        const cls = lemma ? 'gw-lemma' : 'gw-lemma gw-lemma-empty';
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
  const warning = missing > 0
    ? `<div class="gw-warning">⚠ 단어 블록 ${missing}개에 base form 이 입력되지 않아 (?) 로 표시됩니다.</div>`
    : '';

  // 각 블록의 정답 = 원문에 있던 어형(토큰). baseForm 은 괄호로 노출된 원형.
  const blockInfo = wordBlocks.map(b => {
    const sent = opts.sentences.find(s => s.idx === b.sentenceIdx);
    const answer = sent ? joinTokens(sent.tokens.slice(b.startTokenIdx, b.endTokenIdx + 1)) : '';
    const lemma = (b.baseForm ?? '').trim();
    return { answer, lemma };
  });

  const writeRows = wordBlocks.length
    ? blockInfo.map((info, i) => `<div class="gw-write-row"><span class="gw-num">${i + 1}.</span>${info.lemma ? `<span class="gw-snippet">(${escapeHtml(info.lemma)})</span>` : ''}<span class="gw-line"></span></div>`).join('\n')
    : '<div class="gw-meta">선택된 단어 블록이 없습니다.</div>';

  const main = `<section class="gw-section gw-section-F">
${questionBar('F', '어형 변환', opts)}
<div class="gw-instruction">▸ 괄호 안의 단어를 문맥에 맞게 어형 변환하여 빈칸을 완성하세요.</div>
${warning}
<div class="gw-passage">${body}</div>
<div class="gw-write-block">${writeRows}</div>
</section>`;

  // 정답지 — 번호별 정답 어형 (← 원형)
  const answerCards = blockInfo.length
    ? blockInfo
        .map((info, i) => `<div class="gw-answer-card">
  <div class="ac-head"><span class="lab">${i + 1}.</span><b>${escapeHtml(info.answer)}</b>${info.lemma ? `<span class="arrow">←</span>${escapeHtml(info.lemma)}` : ''}</div>
</div>`)
        .join('\n')
    : '';

  const answerKey = blockInfo.length
    ? `<section class="gw-answer-key">
${answerKeyHeader('어형 변환', opts.sourceKey)}
${answerCards}
</section>`
    : '';

  return htmlShell(`${opts.title} — 어형 변환`, `${header(opts, true)}
${main}
${answerKey}`);
}

// ── G. 양자택일 ───────────────────────────────────────────────────────────────

export interface EitherOrPoint {
  sentenceIdx: number;
  startTokenIdx: number;
  endTokenIdx: number;
  /** 원문에 들어 있는 형태 (정답). */
  correctForm: string;
  /** 사용자가 입력한 함정 형태. */
  wrongForm: string;
  /** 정답지의 「왜 이게 답인지」 어법 설명. */
  explanation?: string;
}

export interface BuildEitherOrOptions extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
  sentences: SentenceTokenized[];
  points: EitherOrPoint[];
}

interface EitherOrRendered {
  /** 1-base 표시 번호. */
  num: number;
  /** 정답. */
  correctForm: string;
  /** 함정. */
  wrongForm: string;
  /** 정답이 `[ a / b ]` 의 왼쪽이면 '앞', 오른쪽이면 '뒤'. */
  pos: '앞' | '뒤';
  /** 정답지 설명. */
  explanation?: string;
}

export function buildEitherOrHtml(opts: BuildEitherOrOptions): string {
  const sortedPoints = [...opts.points].sort((a, b) => {
    if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
    return a.startTokenIdx - b.startTokenIdx;
  });

  const rendered: EitherOrRendered[] = [];
  let missing = 0;

  const sentenceHtmls = opts.sentences.map(s => {
    const here = sortedPoints.filter(p => p.sentenceIdx === s.idx);
    if (here.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const pt = here.find(p => p.startTokenIdx === i);
      if (pt) {
        const correctTxt = pt.correctForm.trim() || joinTokens(s.tokens.slice(pt.startTokenIdx, pt.endTokenIdx + 1));
        const wrongTxt = pt.wrongForm.trim();
        if (!wrongTxt) missing += 1;
        const num = rendered.length + 1;
        const seed = (pt.sentenceIdx + 1) * 1009 + (pt.startTokenIdx + 1) * 31 + correctTxt.length;
        const rng = mulberry32(seed);
        const correctFirst = rng() < 0.5;
        const a = correctFirst ? correctTxt : (wrongTxt || '?');
        const b = correctFirst ? (wrongTxt || '?') : correctTxt;
        out.push(`<span class="gw-pick">[ ${escapeHtml(a)} <span class="sep">/</span> ${escapeHtml(b)} ]</span>`);
        rendered.push({
          num,
          correctForm: correctTxt,
          wrongForm: wrongTxt || '(미입력)',
          pos: correctFirst ? '앞' : '뒤',
          explanation: pt.explanation,
        });
        i = pt.endTokenIdx + 1;
        continue;
      }
      const inMid = here.some(p => i > p.startTokenIdx && i <= p.endTokenIdx);
      if (!inMid) out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });

  const body = sentenceHtmls.join(' ');
  const warning = missing > 0
    ? `<div class="gw-warning">⚠ 함정 형태(wrongForm) 가 입력되지 않은 포인트 ${missing}개는 ? 로 표시됩니다.</div>`
    : '';

  const answerCards = rendered.length
    ? rendered
        .map(
          r => `<div class="gw-answer-card">
  <div class="ac-head"><span class="lab">${r.num}.</span><b>${escapeHtml(r.correctForm)}</b><span class="pos">정답 ${r.pos}</span></div>
  ${explainBlock(r.explanation)}
</div>`,
        )
        .join('\n')
    : '';

  const answerKey = rendered.length
    ? `<section class="gw-answer-key">
${answerKeyHeader('양자택일', opts.sourceKey)}
${answerCards}
</section>`
    : '';

  const noPoints =
    rendered.length === 0
      ? '<div class="gw-meta">선택된 어법 포인트가 없습니다.</div>'
      : '';

  const main = `<section class="gw-section gw-section-G">
${questionBar('G', '양자택일', opts)}
<div class="gw-instruction">▸ 본문의 [ A / B ] 중 어법상 옳은 표현에 직접 동그라미 하세요.</div>
${warning}
<div class="gw-passage">${body}</div>
${noPoints}
</section>`;

  return htmlShell(`${opts.title} — 양자택일`, `${header(opts, true)}
${main}
${answerKey}`);
}

// ── H. 어법 오류 수정 ─────────────────────────────────────────────────────────

export interface CorrectionSpan {
  sentenceIdx: number;
  startTokenIdx: number;
  endTokenIdx: number;
  /** true = 실제 오류 (지문에 wrongForm 치환·정답에 노출), false = 함정(번호만 부여). */
  isError: boolean;
  /** isError 일 때 지문에 채울 오답 표현 (비어 있으면 원문 그대로). */
  wrongForm?: string;
  /** isError 일 때의 올바른 표현. 비어 있으면 원문 토큰을 그대로 정답으로 사용. */
  correction?: string;
  /** 정답지 어법 설명 (isError 일 때만 사용). */
  explanation?: string;
}

export interface BuildCorrectionOptions extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
  sentences: SentenceTokenized[];
  spans: CorrectionSpan[];
}

interface CorrectionRendered {
  /** placed 순서 (0-base) — 동그라미 번호와 일치. */
  idx: number;
  isError: boolean;
  /** 지문에 보이는(=오답으로 치환된) 표현. */
  shown: string;
  /** 올바른 표현 (정답 출력용). isError 일 때만 의미. */
  correction: string;
  /** 정답지 설명. */
  explanation?: string;
}

export function buildCorrectionHtml(opts: BuildCorrectionOptions): string {
  const sortedSpans = [...opts.spans].sort((a, b) => {
    if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
    return a.startTokenIdx - b.startTokenIdx;
  });

  const rendered: CorrectionRendered[] = [];
  let missing = 0;

  const sentenceHtmls = opts.sentences.map(s => {
    const here = sortedSpans.filter(sp => sp.sentenceIdx === s.idx);
    if (here.length === 0) return escapeHtml(s.text);
    const out: string[] = [];
    let i = 0;
    while (i < s.tokens.length) {
      const sp = here.find(x => x.startTokenIdx === i);
      if (sp) {
        const original = joinTokens(s.tokens.slice(sp.startTokenIdx, sp.endTokenIdx + 1));
        const wrong = (sp.wrongForm ?? '').trim();
        const correction = (sp.correction ?? '').trim() || original;
        if (sp.isError && !wrong) missing += 1;
        const shown = sp.isError ? (wrong || original) : original;
        const idx = rendered.length;
        rendered.push({ idx, isError: sp.isError, shown, correction, explanation: sp.explanation });
        const cls = sp.isError && wrong ? 'gw-wrong-form' : '';
        const shownHtml = cls ? `<span class="${cls}">${escapeHtml(shown)}</span>` : escapeHtml(shown);
        out.push(`<span class="gw-circle">${circleMark(idx)}</span>${shownHtml}`);
        i = sp.endTokenIdx + 1;
        continue;
      }
      const inMid = here.some(x => i > x.startTokenIdx && i <= x.endTokenIdx);
      if (!inMid) out.push(escapeHtml(s.tokens[i]));
      i++;
    }
    return out.join(' ').replace(/\s+([,.;:!?])/g, '$1');
  });

  const body = sentenceHtmls.join(' ');
  const warning = missing > 0
    ? `<div class="gw-warning">⚠ 오류로 표기됐지만 wrongForm 이 비어 있는 구간 ${missing}개는 원문 그대로 표시됩니다.</div>`
    : '';

  const errorRows = rendered.filter(r => r.isError);
  const writeRows = errorRows.length
    ? errorRows
        .map(
          r => `<div class="gw-write-row">
  <span class="gw-num">${circleMark(r.idx)}</span>
  <span class="gw-snippet">${escapeHtml(r.shown)}</span>
  <span class="gw-snippet">→</span>
  <span class="gw-line"></span>
</div>`,
        )
        .join('\n')
    : '<div class="gw-meta">오류로 표시된 구간이 없습니다. 동그라미 번호만 부여됩니다.</div>';

  const answerCards = errorRows.length
    ? errorRows
        .map(
          r => `<div class="gw-answer-card">
  <div class="ac-head"><span class="lab">${circleMark(r.idx)}</span><b>${escapeHtml(r.shown)}</b><span class="arrow">→</span><b>${escapeHtml(r.correction)}</b></div>
  ${explainBlock(r.explanation)}
</div>`,
        )
        .join('\n')
    : '';

  const answerKey = errorRows.length
    ? `<section class="gw-answer-key">
${answerKeyHeader('어법 오류 수정', opts.sourceKey)}
${answerCards}
</section>`
    : '';

  const main = `<section class="gw-section gw-section-H">
${questionBar('H', '어법 오류 수정', opts)}
<div class="gw-instruction">▸ 본문 동그라미 ①②③… 표시 중 어법상 오류가 있는 모든 보기를 골라 바르게 고쳐 쓰세요. (함정 포함)</div>
${warning}
<div class="gw-passage">${body}</div>
<div class="gw-write-block">${writeRows}</div>
</section>`;

  return htmlShell(`${opts.title} — 어법 오류 수정`, `${header(opts, true)}
${main}
${answerKey}`);
}

// ── J. O·X 채점 ───────────────────────────────────────────────────────────────

export interface OxItem {
  text: string;
  isCorrect: boolean;
  /** isCorrect=false 일 때 올바른 표현. */
  correction?: string;
  /** 정답지 어법 설명. */
  explanation?: string;
}

export interface BuildOxOptions extends ExamMeta {
  title: string;
  textbook: string;
  sourceKey: string;
  intro?: string;
  items: OxItem[];
}

export function buildOxHtml(opts: BuildOxOptions): string {
  const validItems = opts.items.filter(it => it.text.trim());
  const missing = validItems.filter(it => !it.isCorrect && !(it.correction ?? '').trim()).length;

  // 통합 행: [번호] [문장] [O/X] [고쳐쓰기 → ___]
  const rowsHtml = validItems.length
    ? validItems
        .map(
          (it, i) => `<div class="gw-ox-row">
  <span class="gw-ox-num">${circleMark(i)}</span>
  <span class="gw-ox-sent">${escapeHtml(it.text.trim())}</span>
  <span class="gw-ox-buttons"><span>O</span><span>X</span></span>
  <span class="gw-ox-fix">→ <span class="gw-line"></span></span>
</div>`,
        )
        .join('\n')
    : '<div class="gw-meta">보기 항목이 없습니다.</div>';

  const answerCards = validItems.length
    ? validItems
        .map((it, i) => {
          const mark = circleMark(i);
          const head = it.isCorrect
            ? `<div class="ac-head"><span class="lab">${mark}</span><span class="ok">O</span><span class="arrow">—</span>옳음</div>`
            : `<div class="ac-head"><span class="lab">${mark}</span><span class="ng">X</span><span class="arrow">→</span><b>${(it.correction ?? '').trim() ? escapeHtml((it.correction ?? '').trim()) : '<span style="color:#92400e">(고쳐 쓰기 비어 있음)</span>'}</b></div>`;
          return `<div class="gw-answer-card">
  ${head}
  ${explainBlock(it.explanation)}
</div>`;
        })
        .join('\n')
    : '';

  const warning = missing > 0
    ? `<div class="gw-warning">⚠ X 로 표시된 보기 ${missing}개에 「올바른 표현」이 입력되지 않았습니다.</div>`
    : '';

  const intro = (opts.intro ?? '').trim() || '※ 보기가 옳으면 O, 틀리면 X. 틀린 것은 바르게 고쳐 쓰세요.';

  const answerKey = validItems.length
    ? `<section class="gw-answer-key">
${answerKeyHeader('O·X 채점', opts.sourceKey)}
${answerCards}
</section>`
    : '';

  const main = `<section class="gw-section gw-section-J">
${questionBar('J', 'O·X 채점', opts)}
<div class="gw-instruction">${escapeHtml(intro)}</div>
${warning}
<div class="gw-ox-list">${rowsHtml}</div>
</section>`;

  return htmlShell(`${opts.title} — O·X 채점`, `${header(opts, true)}
${main}
${answerKey}`);
}
