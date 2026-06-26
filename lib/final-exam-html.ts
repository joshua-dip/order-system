/**
 * 파이널 예비 모의고사 — 시험지(문제지)·정답해설지 HTML 빌더.
 * puppeteer A4 세로 PDF 렌더용. 문제지는 실제 모의고사처럼 2단 컬럼.
 */

export interface FinalExamQuestion {
  num: number;
  type: string;
  sourceKey: string;
  question: string;
  paragraph: string;
  /** "###" 구분 보기 문자열 (삽입류는 "①\n②\n…" 형태) */
  options: string;
  correctAnswer: string;
  explanation: string;
  /** generated_questions._id (채점용) */
  questionId?: string;
  /** 고유번호 (V-NNNNNN) — 출처 옆에 표기, 이전 출제분 추적용 */
  serialNo?: number | null;
  /** 회차(interleave 모드) — 값이 바뀌면 시험지에 "N회차" 구분선 */
  round?: number;
  /** 지문(도표) 그래프 이미지 — base64 data URI. 있으면 본문 위에 인쇄(25번 도표 등). */
  graphImage?: string | null;
}

/** 고유번호 표시 문자열 (V-NNNNNN). 없으면 ''. */
export function fmtFinalSerial(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? `V-${String(n).padStart(6, '0')}` : '';
}

export interface FinalExamBuildInput {
  title: string;
  subtitle?: string;
  questions: FinalExamQuestion[];
  /** QR 채점 — 문제지 헤더에 인쇄할 QR (dataURL) + 안내 라벨 */
  qrDataUrl?: string;
  qrLabel?: string;
  /** 학생 이름 — 있으면 헤더에 "이름: …" 표기(학생별 개별 문제지). 없으면 빈 이름란. */
  studentName?: string;
  /** 서버(Lambda) 한글 렌더용 @font-face 임베드 CSS (getEmbeddedKoreanFontFaceCss) */
  fontFaceCss?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 본문 안 <u>밑줄</u> 마크업만 살리고 나머지는 escape */
function escKeepUnderline(s: string): string {
  return esc(s)
    .replace(/&lt;u&gt;/g, '<u>')
    .replace(/&lt;\/u&gt;/g, '</u>');
}

const CIRCLED = ['①', '②', '③', '④', '⑤'];

function renderOptions(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  /* 삽입류 — "①\n②\n…" : 한 줄 인라인으로 */
  if (/^[①②③④⑤][\s\n]*[①②③④⑤]/.test(t.replace(/\s+/g, ''))&& !t.includes('###')) {
    const nums = t.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    return `<div class="opts-inline">${nums.map(esc).join('&nbsp;&nbsp;&nbsp;')}</div>`;
  }
  const parts = t.split(/\s*###\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  /* 어법형 "①###②###…" — 번호만 */
  if (parts.every((p) => /^[①②③④⑤]$/.test(p))) {
    return `<div class="opts-inline">${parts.map(esc).join('&nbsp;&nbsp;&nbsp;')}</div>`;
  }
  const lines = parts.map((p, i) => {
    const hasNum = /^[①②③④⑤]/.test(p);
    const text = hasNum ? p : `${CIRCLED[i] ?? '•'} ${p}`;
    return `<div class="opt">${escKeepUnderline(text)}</div>`;
  });
  return lines.join('\n');
}

const INSERT_TYPES = new Set(['삽입', '삽입-고난도']);

function latinCount(s: string): number {
  return (s.match(/[A-Za-z]/g) ?? []).length;
}

/**
 * 삽입류 중 일부 문항은 "주어진 문장"이 Question 필드에 잘못 합쳐져 있다
 * (예: "…가장 적절한 곳은?\n\nThis setback…"). 한국어 지시문과 영어 주어진 문장을 분리해
 * 지시문만 문제 줄에 두고, 주어진 문장은 본문 박스 맨 앞 블록으로 보낸다.
 */
function splitGivenSentence(type: string, question: string): { instruction: string; given: string } {
  const q = (question ?? '').trim();
  if (!INSERT_TYPES.has(type)) return { instruction: q, given: '' };
  const m = q.match(/^([\s\S]*?(?:\?|시오\.))\s*([\s\S]*)$/);
  if (m && m[2].trim() && latinCount(m[2]) >= 10) {
    return { instruction: m[1].trim(), given: m[2].trim() };
  }
  return { instruction: q, given: '' };
}

/**
 * 본문 렌더링 — "###" 구분자를 시각적 블록으로 분리(### 가 그대로 노출되지 않도록).
 * 순서: 주어진 글 / (A) / (B) / (C), 삽입: 주어진 문장 / 본문 으로 각각 분리된다.
 * leakedGiven 이 있으면(삽입 Question leak) 맨 앞 블록으로 붙인다.
 */
function renderParagraph(leakedGiven: string, paragraph: string): string {
  const chunks: string[] = [];
  if (leakedGiven) chunks.push(leakedGiven);
  for (const part of (paragraph ?? '').split(/\s*###\s*/)) {
    const t = part.trim();
    if (t) chunks.push(t);
  }
  if (chunks.length === 0) return '';
  return chunks
    .map((c) => `<div class="q-para-block">${escKeepUnderline(c).replace(/\n/g, '<br/>')}</div>`)
    .join('');
}

function questionBlock(q: FinalExamQuestion): string {
  const { instruction, given } = splitGivenSentence(q.type, q.question);
  const graph =
    typeof q.graphImage === 'string' && q.graphImage.startsWith('data:image/')
      ? `<div class="q-graph"><img src="${q.graphImage}" alt="도표"/></div>`
      : '';
  return `<div class="q">
  <div class="q-head"><span class="q-num">${q.num}.</span> ${escKeepUnderline(instruction)}</div>
  <div class="q-src">[${esc(q.type)}] ${esc(q.sourceKey)}${fmtFinalSerial(q.serialNo) ? ` <span class="q-serial">${esc(fmtFinalSerial(q.serialNo))}</span>` : ''}</div>
  ${graph}<div class="q-para">${renderParagraph(given, q.paragraph)}</div>
  <div class="q-opts">${renderOptions(q.options)}</div>
</div>`;
}

const COMMON_CSS = `
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  html, body { background: #fff; }
  body { font-family: 'NanumGothicEmbedded', 'CircledFallbackEmbedded', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; margin: 0; color: #111; }
  .sheet { padding: 0; }
  .head {
    border: 2.5px solid #111; border-radius: 6px; padding: 10px 16px; margin-bottom: 14px;
    display: flex; align-items: baseline; justify-content: space-between;
  }
  .head .t { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; }
  .head .s { font-size: 11px; color: #444; }
  @page { size: A4 portrait; margin: 12mm 11mm; }
`;

/** 회차 구분선 포함 문항 본문 (cols 안에 들어갈 내용) */
function renderQuestionBody(questions: FinalExamQuestion[]): string {
  let prevRound: number | undefined;
  return questions
    .map((q) => {
      let prefix = '';
      if (typeof q.round === 'number' && q.round !== prevRound) {
        prefix = `<div class="round-divider">${q.round}회차</div>`;
        prevRound = q.round;
      }
      return prefix + questionBlock(q);
    })
    .join('\n');
}

/** 문제지 한 장(.sheet) — 합본/단일 공용. breakBefore 면 홀수(우)페이지에서 시작. */
function sheetInnerHtml(input: FinalExamBuildInput, breakBefore = false): string {
  const body = renderQuestionBody(input.questions);
  const qr = input.qrDataUrl
    ? `<div class="qr">
        <img src="${input.qrDataUrl}" alt="QR 채점" />
        <div class="qr-label">${esc(input.qrLabel ?? 'QR 스캔 → 바로 채점')}</div>
      </div>`
    : '';
  return `<div class="sheet${breakBefore ? ' sheet-break' : ''}">
  <div class="head-wrap">
    <div class="head"><span class="t">${esc(input.title)}</span><span class="s">${esc(input.subtitle ?? '')}</span></div>
    ${qr}
  </div>
  <div class="namebar"><span class="nm-label">이름</span><span class="nm-val">${input.studentName ? esc(input.studentName) : ''}</span></div>
  <div class="cols">
${body}
  </div>
</div>`;
}

/** 문제지 시트 전용 스타일 (단일·합본 공용) */
const SHEET_CSS = `
  .head-wrap { display: flex; align-items: stretch; gap: 8px; margin-bottom: 10px; }
  .head-wrap .head { flex: 1; margin-bottom: 0; }
  .namebar { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 5px 10px; border: 1px solid #999; border-radius: 4px; }
  .namebar .nm-label { font-size: 10pt; font-weight: 800; color: #333; flex: none; }
  .namebar .nm-val { flex: 1; font-size: 12pt; font-weight: 700; color: #111; border-bottom: 1px solid #ccc; min-height: 16px; padding-bottom: 1px; }
  .qr { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
  .qr img { width: 21mm; height: 21mm; }
  .qr-label { font-size: 7pt; color: #333; font-weight: 700; white-space: nowrap; }
  .round-divider { column-span: all; margin: 4px 0 10px; padding: 3px 0; border-top: 2px solid #7c3aed; border-bottom: 2px solid #7c3aed; text-align: center; font-weight: 800; font-size: 10.5pt; color: #7c3aed; letter-spacing: 1px; }
  .cols { column-count: 2; column-gap: 9mm; column-rule: 1px solid #bbb; }
  .q { break-inside: avoid; margin-bottom: 14px; font-size: 10pt; line-height: 1.5; }
  .q-head { font-weight: 700; margin-bottom: 3px; }
  .q-num { font-weight: 800; }
  .q-src { font-size: 7.5pt; color: #8a8a8a; font-weight: 600; margin-bottom: 5px; }
  .q-serial { color: #b06a00; font-weight: 700; letter-spacing: 0.3px; }
  .q-graph { margin: 0 0 6px; text-align: center; break-inside: avoid; }
  .q-graph img { max-width: 100%; max-height: 62mm; height: auto; border: 1px solid #999; border-radius: 4px; }
  .q-para {
    border: 1.2px solid #555; border-radius: 4px; padding: 7px 9px; margin-bottom: 6px;
    font-size: 9.5pt; line-height: 1.55;
  }
  .q-para-block { margin: 0 0 6px; }
  .q-para-block:last-child { margin-bottom: 0; }
  .q-opts .opt { margin: 2px 0; font-size: 9.5pt; }
  .opts-inline { font-size: 10pt; letter-spacing: 2px; }
  /* 합본: 학생마다 새 페이지에서 시작 + 홀수페이지 정렬용 빈 페이지(짝수로 끝난 학생 뒤) */
  .sheet-break { break-before: page; page-break-before: page; }
  .blank-page { break-before: page; page-break-before: page; break-after: page; page-break-after: page; }
`;

export function buildFinalExamSheetHtml(input: FinalExamBuildInput): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(input.title)}</title>
<style>
${input.fontFaceCss ?? ''}
${COMMON_CSS}
${SHEET_CSS}
</style></head>
<body>
${sheetInnerHtml(input)}
</body></html>`;
}

/**
 * 여러 학생 문제지를 한 PDF 로 합본 — 각 학생이 새 페이지에서 시작하고, 양면 인쇄 시
 * 학생마다 새 용지 앞면(홀수페이지)에서 시작하도록 `blankBefore[i]` 가 true 인 학생 앞에
 * 빈 페이지를 한 장 끼운다. blankBefore 는 호출부에서 각 학생의 실제 페이지 수로 계산한다
 * (Chrome 헤드리스 print 는 `break-before: right` 로 빈 페이지를 만들지 못하므로 직접 삽입).
 */
export function buildFinalExamSheetMultiHtml(
  sheets: FinalExamBuildInput[],
  opts?: { fontFaceCss?: string; docTitle?: string; blankBefore?: boolean[] },
): string {
  const body = sheets
    .map((s, i) => {
      const blank = opts?.blankBefore?.[i] ? '<div class="blank-page">&nbsp;</div>' : '';
      return blank + sheetInnerHtml(s, i > 0);
    })
    .join('\n');
  const docTitle = opts?.docTitle ?? sheets[0]?.title ?? '파이널 예비 모의고사';
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(docTitle)}</title>
<style>
${opts?.fontFaceCss ?? ''}
${COMMON_CSS}
${SHEET_CSS}
</style></head>
<body>
${body}
</body></html>`;
}

export function buildFinalExamAnswerHtml(input: FinalExamBuildInput): string {
  // 빠른 정답표 — 번호+답만 (최상단)
  const quick = input.questions
    .map((q) => `<div class="qa"><span class="qn">${q.num}</span><span class="qv">${esc(q.correctAnswer)}</span></div>`)
    .join('');
  const rows = input.questions
    .map(
      (q) =>
        `<tr><td>${q.num}</td><td>${esc(q.type)}</td><td class="src">${esc(q.sourceKey)}${fmtFinalSerial(q.serialNo) ? ` · ${esc(fmtFinalSerial(q.serialNo))}` : ''}</td><td class="ans">${esc(q.correctAnswer)}</td></tr>`,
    )
    .join('\n');
  const expls = input.questions
    .map(
      (q) => `<div class="ex">
  <div class="ex-head">${q.num}. <span class="ex-ans">정답 ${esc(q.correctAnswer)}</span> <span class="ex-type">[${esc(q.type)}] ${esc(q.sourceKey)}${fmtFinalSerial(q.serialNo) ? ` · ${esc(fmtFinalSerial(q.serialNo))}` : ''}</span></div>
  <div class="ex-body">${escKeepUnderline(q.explanation || '해설이 제공되지 않은 문항입니다.')}</div>
</div>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(input.title)} — 정답 및 해설</title>
<style>
${input.fontFaceCss ?? ''}
${COMMON_CSS}
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 16px; }
  th, td { border: 1px solid #888; padding: 4px 8px; text-align: center; }
  th { background: #f1f1f1; font-weight: 700; }
  td.src { text-align: left; font-size: 8.5pt; color: #333; }
  td.ans { font-weight: 800; }
  .ex { break-inside: avoid; margin-bottom: 10px; font-size: 9.5pt; line-height: 1.55; }
  .ex-head { font-weight: 700; margin-bottom: 2px; }
  .ex-ans { color: #b91c1c; }
  .ex-type { color: #555; font-weight: 400; font-size: 8.5pt; }
  .ex-body { color: #222; }
  .quick-title { font-weight: 800; font-size: 10pt; margin: 0 0 5px; }
  .quick { display: grid; grid-template-columns: repeat(10, 1fr); border-top: 1.5px solid #555; border-left: 1.5px solid #555; margin-bottom: 16px; }
  .qa { display: flex; align-items: center; justify-content: center; gap: 3px; padding: 3px 2px; font-size: 9pt; border-right: 1px solid #bbb; border-bottom: 1px solid #bbb; }
  .qa .qn { color: #555; font-weight: 700; }
  .qa .qv { font-weight: 800; }
</style></head>
<body>
<div class="sheet">
  <div class="head"><span class="t">${esc(input.title)} — 정답 및 해설</span><span class="s">${esc(input.subtitle ?? '')}</span></div>
  <div class="quick-title">■ 빠른 정답</div>
  <div class="quick">${quick}</div>
  <table>
    <thead><tr><th>문항</th><th>유형</th><th>출처</th><th>정답</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <div class="expl">
${expls}
  </div>
</div>
</body></html>`;
}
