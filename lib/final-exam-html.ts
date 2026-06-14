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
}

export interface FinalExamBuildInput {
  title: string;
  subtitle?: string;
  questions: FinalExamQuestion[];
  /** QR 채점 — 문제지 헤더에 인쇄할 QR (dataURL) + 안내 라벨 */
  qrDataUrl?: string;
  qrLabel?: string;
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

function questionBlock(q: FinalExamQuestion): string {
  return `<div class="q">
  <div class="q-head"><span class="q-num">${q.num}.</span> ${escKeepUnderline(q.question)}</div>
  <div class="q-para">${escKeepUnderline(q.paragraph).replace(/\n/g, '<br/>')}</div>
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

export function buildFinalExamSheetHtml(input: FinalExamBuildInput): string {
  const body = input.questions.map(questionBlock).join('\n');
  const qr = input.qrDataUrl
    ? `<div class="qr">
        <img src="${input.qrDataUrl}" alt="QR 채점" />
        <div class="qr-label">${esc(input.qrLabel ?? 'QR 스캔 → 바로 채점')}</div>
      </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(input.title)}</title>
<style>
${input.fontFaceCss ?? ''}
${COMMON_CSS}
  .head-wrap { display: flex; align-items: stretch; gap: 8px; margin-bottom: 14px; }
  .head-wrap .head { flex: 1; margin-bottom: 0; }
  .qr { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
  .qr img { width: 21mm; height: 21mm; }
  .qr-label { font-size: 7pt; color: #333; font-weight: 700; white-space: nowrap; }
  .cols { column-count: 2; column-gap: 9mm; column-rule: 1px solid #bbb; }
  .q { break-inside: avoid; margin-bottom: 14px; font-size: 10pt; line-height: 1.5; }
  .q-head { font-weight: 700; margin-bottom: 5px; }
  .q-num { font-weight: 800; }
  .q-para {
    border: 1.2px solid #555; border-radius: 4px; padding: 7px 9px; margin-bottom: 6px;
    font-size: 9.5pt; line-height: 1.55;
  }
  .q-opts .opt { margin: 2px 0; font-size: 9.5pt; }
  .opts-inline { font-size: 10pt; letter-spacing: 2px; }
</style></head>
<body>
<div class="sheet">
  <div class="head-wrap">
    <div class="head"><span class="t">${esc(input.title)}</span><span class="s">${esc(input.subtitle ?? '')}</span></div>
    ${qr}
  </div>
  <div class="cols">
${body}
  </div>
</div>
</body></html>`;
}

export function buildFinalExamAnswerHtml(input: FinalExamBuildInput): string {
  const rows = input.questions
    .map(
      (q) =>
        `<tr><td>${q.num}</td><td>${esc(q.type)}</td><td class="src">${esc(q.sourceKey)}</td><td class="ans">${esc(q.correctAnswer)}</td></tr>`,
    )
    .join('\n');
  const expls = input.questions
    .map(
      (q) => `<div class="ex">
  <div class="ex-head">${q.num}. <span class="ex-ans">정답 ${esc(q.correctAnswer)}</span> <span class="ex-type">[${esc(q.type)}] ${esc(q.sourceKey)}</span></div>
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
</style></head>
<body>
<div class="sheet">
  <div class="head"><span class="t">${esc(input.title)} — 정답 및 해설</span><span class="s">${esc(input.subtitle ?? '')}</span></div>
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
