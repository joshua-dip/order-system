/**
 * 서술형(narrative_questions) 인쇄 양식 — lib/variant-print-html.ts 의 서술형 버전.
 *
 * 객관식 변형과 달리 선택지가 없고 본문 안에 빈칸 (A) 와 <보기> 단어 목록이 함께
 * 들어 있다(question_data.본문 에 이미 "\n<보기>: …" 로 붙어 저장돼 있다 — 그대로
 * 문단으로 쪼개 보여 주면 된다). 정답은 모범답안 문장, 해설은 한국어 서술.
 */

const TYPE_PRINT_NAME: Record<string, string> = {
  '빈칸재배열형(A+B·주제·Hard)': '빈칸 재배열 — 주제 (Hard)',
  '빈칸재배열형(A+B·어법·Hard)': '빈칸 재배열 — 어법 (Hard)',
  이중요지영작형: '이중 요지 영작',
  주제완성형: '주제 완성',
  요약문빈칸완성형: '요약문 빈칸 완성',
};

export function narrativeTypePrintName(subtype: string): string {
  return TYPE_PRINT_NAME[subtype.trim()] ?? subtype.trim();
}

export interface NarrativePrintQuestion {
  /** "05회 31번" 처럼 문항 위에 작게 붙는 출처 라벨 */
  source: string;
  /** 발문(문제) */
  question: string;
  /** 본문 — 줄바꿈으로 문단·<보기> 줄이 이미 나뉘어 있다 */
  body: string;
  /** 배점 */
  score?: number;
  /** 모범답안·해설(정답지에만 쓰인다) */
  sampleAnswer?: string;
  explanation?: string;
}

export interface NarrativePrintInput {
  title: string;
  subtitle: string;
  brand?: string;
  questions: NarrativePrintQuestion[];
  includeAnswers?: boolean;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** (A) 빈칸 표식을 강조해서 보여 준다 */
function highlightBlank(s: string): string {
  return esc(s).replace(/\(A\)/g, '<span class="blank">(A)</span>');
}

/**
 * 본문의 줄바꿈을 문단으로. `<보기>:` 로 시작하는 줄은 별도 스타일 박스로 뺀다.
 */
function bodyHtml(text: string): string {
  return String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.startsWith('<보기>')
        ? `<p class="bogi">${highlightBlank(line)}</p>`
        : `<p>${highlightBlank(line)}</p>`,
    )
    .join('\n');
}

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;
  color:#111; font-size:10.5pt; line-height:1.62;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet{padding:16mm 14mm}
.head{border-bottom:2px solid #111; padding-bottom:6px; margin-bottom:14px}
.head .t{display:block; font-size:17pt; font-weight:800; letter-spacing:-0.3px}
.head .s{display:block; margin-top:4px; font-size:8.5pt; color:#666}
.head .brand{margin-left:6px; padding-left:8px; border-left:1px solid #d4d4d4}

.q{margin:0 0 18px; padding-bottom:14px; border-bottom:1px solid #eee; break-inside:avoid; page-break-inside:avoid}
.q:last-child{border-bottom:0}
.q .no{display:inline-block; min-width:18px; padding:1px 5px; margin-right:7px;
  background:#333; color:#fff; font-size:8.5pt; font-weight:700; text-align:center; border-radius:2px}
.q .src{font-size:8.5pt; color:#666}
.q .score{font-size:8.5pt; color:#999; margin-left:6px}
.q .prompt{margin:6px 0 8px; font-weight:700}
.q .passage{border:1px solid #ddd; border-radius:4px; padding:11px 13px; background:#fff}
.q .passage p{margin:0 0 7px; text-align:justify}
.q .passage p:last-child{margin-bottom:0}
.q .passage .blank{font-weight:800; color:#c2410c; padding:0 2px}
.q .passage p.bogi{margin-top:10px; padding-top:9px; border-top:1px dashed #ccc;
  color:#333; font-style:italic; text-align:left}
.q .answer-blank{margin:10px 0 0; padding:8px 11px; border:1px dashed #bbb; border-radius:4px;
  min-height:20px; color:#aaa; font-size:9pt}

.ans-head{margin:0 0 12px; padding-bottom:6px; border-bottom:2px solid #111; font-size:13pt; font-weight:800}
.ans-wrap{break-before:page; page-break-before:always}
.ans{margin:0 0 9px; padding:9px 11px; border:1px solid #e2e2e2; border-radius:4px;
  break-inside:avoid; page-break-inside:avoid}
.ans .k{font-weight:700}
.ans .k .a{color:#d32f2f}
.ans .e{margin-top:4px; color:#333; text-align:justify}
@page{size:A4; margin:0}
`;

export function buildNarrativePrintHtml(input: NarrativePrintInput): string {
  const qs = input.questions ?? [];
  const brand = (input.brand ?? '').trim();

  const oneQuestionHtml = (q: NarrativePrintQuestion, no: number): string => `<div class="q">
  <div><span class="no">${no}</span><span class="src">${esc(q.source)}</span>${q.score ? `<span class="score">[${q.score}점]</span>` : ''}</div>
  <div class="prompt">${esc(q.question)}</div>
  <div class="passage">${bodyHtml(q.body)}</div>
  <div class="answer-blank">답:</div>
</div>`;

  const body = qs.map((q, i) => oneQuestionHtml(q, i + 1)).join('\n');

  const answers = input.includeAnswers
    ? `<div class="ans-wrap">
<div class="ans-head">정답 및 해설</div>
${qs
  .map(
    (q, i) => `<div class="ans">
  <div class="k">${i + 1}. ${esc(q.source)}&nbsp;&nbsp;정답 <span class="a">${esc(q.sampleAnswer ?? '')}</span></div>
  ${q.explanation ? `<div class="e">${esc(q.explanation)}</div>` : ''}
</div>`,
  )
  .join('\n')}
</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>${esc(input.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>${CSS}</style>
</head><body><div class="sheet">
  <div class="head">
    <span class="t">${esc(input.title)}</span>
    <span class="s">${esc(input.subtitle)}${brand ? `<span class="brand">${esc(brand)}</span>` : ''}</span>
  </div>
  ${body}
  ${answers}
</div></body></html>`;
}
