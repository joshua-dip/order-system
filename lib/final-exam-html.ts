/**
 * 내신 예비시험지(옛 파이널 예비 모의고사) — 시험지(문제지)·정답해설지 HTML 빌더.
 *
 * 양식은 학원웹(리체움) 예비시험지(lib/mock-exam-paper.ts)를 따른다 — 학교 내신 시험지 짜임:
 * 3칸 머리글 상자 · 이름/점수 칸 · 유의 사항 · 선택형 뒤 서·논술형 · 같은 발문 묶음 [a~b] ·
 * 명조/Times 본문 · 지문 끝 요약 상자 · 쪽 아래 표기(A4 2단). 원장님이 학원웹 양식이 마음에 든다고 해서
 * 2026-09-27 옮겨 왔다.
 *
 * 한 HTML 을 세 곳이 쓴다: 서버 PDF(puppeteer, Lambda) · 보관함 미리보기(iframe) · 브라우저 인쇄.
 * - Lambda Chromium 엔 한글 폰트가 없어 NanumGothic 을 임베드(fontFaceCss)하고, 명조·Times 대용(Tinos)은
 *   Google Fonts 로 불러온다(클래스키트 PDF 와 같은 방식). 못 불러오면 임베드 고딕으로 떨어진다.
 * - 화면(@media screen)에는 쪽 높이가 없어 2단이 한 단으로 몰리므로, 인쇄 단 폭 한 단으로 보여 준다.
 */

import { splitQuestionOptionSegments } from './question-options-segments';
import { displayFinalExamTitle, FINAL_EXAM_PRODUCT_NAME } from './final-exam-title';

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
  /** 고유번호 (V-NNNNNN) — 정답과 해설에 출처와 함께 표기, 이전 출제분 추적용 */
  serialNo?: number | null;
  /** 회차(interleave 모드) — 값이 바뀌면 시험지에 "N회차" 구분 */
  round?: number;
  /** 지문(도표) 그래프 이미지 — base64 data URI. 있으면 본문 위에 인쇄(25번 도표 등). */
  graphImage?: string | null;
  /** 서술형 주관식(주제완성형 등) — true 면 ①②③④⑤ 보기 대신 조건·빈칸틀로 렌더. QR 자동채점 제외. */
  subjective?: boolean;
  /** 주관식 배점 (서술형은 보통 5점) */
  points?: number;
  /** 주제완성형: 빈칸 앞 제시 어구 (예: "the historical pursuit of") */
  frame?: string;
  /** 주관식 제시 어구(변형불가) — ' / ' 구분 (예: "machines / creating / like humans") */
  given?: string;
  /** 주관식 조건문 (줄바꿈 구분 ①②③) */
  conditions?: string;
  /** 주관식 모범답안 (정답·해설지용; 주제완성형은 빈칸을 채운 명사구) */
  modelAnswer?: string;
  /** 요약문빈칸완성형: (A)(B)(C) 빈칸이 든 한 문장 요약 */
  summary?: string;
  /** 요약문빈칸완성형: 답란 (기호·단어수·답) */
  blanks?: { label: string; words: number; answer: string }[];
}

/** 고유번호 표시 문자열 (V-NNNNNN). 없으면 ''. */
export function fmtFinalSerial(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? `V-${String(n).padStart(6, '0')}` : '';
}

/** 머리글 상자 — 왼쪽(시험 구분) · 가운데(제목·부제) · 오른쪽(범위) */
export interface FinalExamHeader {
  left: string[];
  title: string;
  subtitle: string;
  right: string[];
}

export interface FinalExamBuildInput {
  title: string;
  subtitle?: string;
  questions: FinalExamQuestion[];
  /** 머리글 상자 — 없으면 title·subtitle 로 만든다 */
  header?: FinalExamHeader;
  /** QR 채점 — 문제지 머리글에 인쇄할 QR (dataURL) + 안내 라벨 */
  qrDataUrl?: string;
  qrLabel?: string;
  /** 학생 이름 — 있으면 이름 칸에 인쇄(학생별 개별 문제지). 없으면 빈 칸. */
  studentName?: string;
  /** 서버(Lambda) 한글 렌더용 @font-face 임베드 CSS (getEmbeddedKoreanFontFaceCss) */
  fontFaceCss?: string;
}

/**
 * 잡 정보로 머리글 상자를 만든다. 제목의 「(학교 · 날짜 · N문항)」 꼬리는 머리글 칸으로 옮기고,
 * 회원이 바꾼 이름은 그대로 가운데에 쓴다.
 */
export function finalExamHeader(input: {
  title: string;
  subtitle?: string;
  school?: string;
  scopeSummary?: string;
  createdAt?: Date | string;
}): FinalExamHeader {
  const shown = displayFinalExamTitle(input.title);
  const main = shown.replace(/\s*\([^()]*\)\s*$/, '').trim() || FINAL_EXAM_PRODUCT_NAME;
  const d = input.createdAt ? new Date(input.createdAt) : null;
  const date = d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const school = (input.school ?? '').trim();
  return {
    left: ['내신 대비 예비시험', school, date].filter(Boolean),
    title: main,
    subtitle: (input.subtitle ?? '').trim(),
    right: input.scopeSummary ? ['시험 범위', input.scopeSummary] : [],
  };
}

function esc(s: string): string {
  return String(s ?? '')
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

/** 문단: 밑줄 유지 + 줄바꿈 */
function richText(s: string): string {
  return escKeepUnderline(s).replace(/\n/g, '<br/>');
}

/** CSS 문자열 리터럴 안에 넣을 값 */
function cssString(s: string): string {
  return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
}

const CIRCLED = ['①', '②', '③', '④', '⑤'];
const plainLen = (s: string) => s.replace(/<[^>]+>/g, '').replace(/^[①②③④⑤]\s*/, '').length;

function renderOptions(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  /* 삽입류 — "①\n②\n…" : 한 줄 인라인으로 */
  if (/^[①②③④⑤][\s\n]*[①②③④⑤]/.test(t.replace(/\s+/g, '')) && !t.includes('###')) {
    const nums = t.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    return `<div class="ch-inline">${nums.map(esc).join('&nbsp;&nbsp;&nbsp;&nbsp;')}</div>`;
  }
  // 보기 구분: `###` 우선, 없으면 줄바꿈(기존 DB 다수 포맷) — 표준 분리기와 동일 규칙
  const parts = splitQuestionOptionSegments(t);
  if (parts.length === 0) return '';
  /* 어법형 "①###②###…" — 번호만 */
  if (parts.every((p) => /^[①②③④⑤]$/.test(p))) {
    return `<div class="ch-inline">${parts.map(esc).join('&nbsp;&nbsp;&nbsp;&nbsp;')}</div>`;
  }
  const ko = parts.filter((p) => /[가-힣]/.test(p)).length > parts.length / 2;
  /* 짧은 영어 보기 5개는 학교 시험지처럼 두 줄로 나란히 */
  const grid = !ko && parts.length === 5 && parts.every((p) => plainLen(p) <= 18);
  const items = parts.map((p, i) => {
    const hasNum = /^[①②③④⑤]/.test(p);
    const text = hasNum ? p : `${CIRCLED[i] ?? '•'} ${p}`;
    return `<li>${escKeepUnderline(text)}</li>`;
  });
  return `<ol class="ch${ko ? ' ko' : ''}${grid ? ' grid' : ''}">${items.join('')}</ol>`;
}

const INSERT_TYPES = new Set(['삽입', '삽입-고난도']);
const GIVEN_FIRST = (type: string) => /^(순서|삽입)/.test(type);
const SUMMARY_LAST = (type: string) => /^요약/.test(type);

function latinCount(s: string): number {
  return (s.match(/[A-Za-z]/g) ?? []).length;
}

/**
 * 삽입류 중 일부 문항은 "주어진 문장"이 Question 필드에 잘못 합쳐져 있다
 * (예: "…가장 적절한 곳은?\n\nThis setback…"). 한국어 지시문과 영어 주어진 문장을 분리해
 * 지시문만 문제 줄에 두고, 주어진 문장은 본문 맨 앞 상자로 보낸다.
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
 * 본문 — "###" 구분 블록을 학교 시험지 모양으로.
 *  순서: 주어진 글(상자) / (A) / (B) / (C) · 삽입: 주어진 문장(상자) / 본문 · 요약: 본문 / 요약문(상자)
 *  그 밖은 들여 쓴 문단. leakedGiven(삽입 Question 에 섞인 주어진 문장)은 맨 앞 상자.
 */
function renderPassage(type: string, leakedGiven: string, paragraph: string): string {
  const chunks = (paragraph ?? '').split(/\s*###\s*/).map((c) => c.trim()).filter(Boolean);
  const out: string[] = [];
  if (leakedGiven) out.push(`<div class="given">${richText(leakedGiven)}</div>`);
  let body = chunks;
  if (!leakedGiven && GIVEN_FIRST(type) && chunks.length > 1) {
    out.push(`<div class="given">${richText(chunks[0])}</div>`);
    body = chunks.slice(1);
  }
  let after = '';
  if (SUMMARY_LAST(type) && body.length > 1) {
    after = `<div class="psg box">${richText(body[body.length - 1])}</div>`;
    body = body.slice(0, -1);
  }
  if (body.length) out.push(`<div class="psg">${body.map((c) => `<p>${richText(c)}</p>`).join('')}</div>`);
  if (after) out.push(after);
  return out.join('');
}

function pointsOf(q: FinalExamQuestion): number {
  return typeof q.points === 'number' && q.points > 0 ? q.points : 5;
}

/** 발문에 이미 [N점] 이 있으면 배점을 중복 표기하지 않는다 */
function ptsTag(q: FinalExamQuestion): string {
  if (/\[\s*\d+(\.\d+)?\s*점\s*\]/.test(q.question)) return '';
  return ` <span class="pt">[${pointsOf(q)}점]</span>`;
}

/** 조건 상자 (① ② ③ …) — 주관식 공통 */
function conditionsBox(conditions?: string): string {
  const lines = (conditions ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<div class="cond"><span class="t">&lt;조 건&gt;</span><ol>${lines
    .map((c, i) => `<li>${escKeepUnderline(/^\s*[①-⑩]/.test(c) ? c : `${CIRCLED[i % 5]} ${c}`)}</li>`)
    .join('')}</ol></div>`;
}

/** 요약문빈칸완성형 — 지문 + 요약문((A)(B)(C) 빈칸) + 조건 + 답란 표. */
function summaryBlankQuestionBlock(q: FinalExamQuestion): string {
  const blanks = q.blanks ?? [];
  let summaryHtml = escKeepUnderline(q.summary ?? '');
  for (const b of blanks) {
    summaryHtml = summaryHtml.split(`(${b.label})`).join(`<span class="sblank">(${esc(b.label)})</span>`);
  }
  const rows = blanks
    .map((b) => `<tr><td class="bl-label">(${esc(b.label)})</td><td class="bl-write"></td><td class="bl-count">${b.words}단어</td></tr>`)
    .join('');
  return `<div class="q sj">
  <div class="qh"><span class="no">${q.num}.</span>${escKeepUnderline(q.question)}${ptsTag(q)}</div>
  ${renderPassage(q.type, '', q.paragraph)}
  <div class="psg box summary">${summaryHtml}</div>
  ${conditionsBox(q.conditions)}
  ${rows ? `<table class="bltab">${rows}</table>` : ''}
</div>`;
}

/** 서술형 주관식(주제완성형 등) — 발문 + 지문 + 빈칸틀 + <보기> 제시 어구 + 조건. */
function subjectiveQuestionBlock(q: FinalExamQuestion): string {
  if (q.summary && (q.blanks?.length ?? 0) > 0) return summaryBlankQuestionBlock(q);
  const givenList = (q.given ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  const bogi = givenList.length
    ? `<div class="bogi"><div class="t">&lt;보 기&gt;</div>${givenList.map((g) => `<span class="chip">${esc(g)}</span>`).join(' / ')}</div>`
    : '';
  const frame = q.frame
    ? `<div class="frame">${escKeepUnderline(q.frame)} <span class="wline"></span></div>`
    : '<div class="lines"><div></div><div></div></div>';
  return `<div class="q sj">
  <div class="qh"><span class="no">${q.num}.</span>${escKeepUnderline(q.question)}${ptsTag(q)}</div>
  ${renderPassage(q.type, '', q.paragraph)}
  ${bogi}
  ${conditionsBox(q.conditions)}
  ${frame}
</div>`;
}

function mcQuestionBlock(q: FinalExamQuestion, grouped: boolean): string {
  const { instruction, given } = splitGivenSentence(q.type, q.question);
  const graph =
    typeof q.graphImage === 'string' && q.graphImage.startsWith('data:image/')
      ? `<div class="graph"><img src="${q.graphImage}" alt="도표"/></div>`
      : '';
  return `<div class="q">
  <div class="qh"><span class="no">${q.num}.</span>${grouped ? '' : escKeepUnderline(instruction)}</div>
  ${graph}${renderPassage(q.type, given, q.paragraph)}
  ${renderOptions(q.options)}
</div>`;
}

/**
 * 문항 본문 — 선택형/서·논술형 구분, 회차 구분, 같은 발문이 이어지면 [a~b] 묶음 지시문.
 */
function renderQuestionBody(questions: FinalExamQuestion[]): string {
  const hasRounds = questions.some((q) => typeof q.round === 'number');
  const out: string[] = [];
  if (!hasRounds && questions.some((q) => !q.subjective)) out.push('<div class="sec">선택형</div>');
  let prevRound: number | undefined;
  let sjStarted = false;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (typeof q.round === 'number' && q.round !== prevRound) {
      out.push(`<div class="sec">${q.round}회차</div>`);
      prevRound = q.round;
    }
    if (q.subjective) {
      if (!sjStarted) { out.push('<div class="sec">서·논술형</div>'); sjStarted = true; }
      out.push(subjectiveQuestionBlock(q));
      continue;
    }
    /* 같은 발문이 이어지는 선택형 묶음 — 학교 시험지의 「[2~3] 다음 글의 요지로 …」 */
    const ins = splitGivenSentence(q.type, q.question).instruction;
    let j = i;
    while (
      j + 1 < questions.length &&
      !questions[j + 1].subjective &&
      questions[j + 1].round === q.round &&
      splitGivenSentence(questions[j + 1].type, questions[j + 1].question).instruction === ins
    ) j++;
    if (j > i && ins) {
      out.push(`<div class="grp">[${q.num}~${questions[j].num}] ${escKeepUnderline(ins)}</div>`);
      for (let k = i; k <= j; k++) out.push(mcQuestionBlock(questions[k], true));
      i = j;
    } else {
      out.push(mcQuestionBlock(q, false));
    }
  }
  out.push('<div class="end">- 끝 -</div>');
  return out.join('\n');
}

const FONTS_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700&family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap">';

/** 양식 CSS — 학원웹 lib/mock-exam-paper.ts 와 같은 치수. foot: 쪽 아래 오른쪽, pageCount: 쪽 번호 표기 여부 */
function paperCss(foot: string, pageCount: boolean): string {
  return `
@page { size: A4; margin: 13mm 11mm 15mm 11mm;
  ${pageCount ? `@bottom-center { content: counter(page) "쪽 / " counter(pages) "쪽"; font: 8.5pt var(--gt); color:#333; }` : ''}
  @bottom-left { content: "무단 복제·배포 금지"; font: 7.5pt var(--gt); color:#666; }
  @bottom-right { content: ${cssString(foot)}; font: 7.5pt var(--gt); color:#666; }
}
:root {
  color-scheme: light;
  --en: 'Times New Roman', Tinos, 'Nanum Myeongjo', 'NanumGothicEmbedded', 'CircledFallbackEmbedded', serif;
  --ko: 'Nanum Myeongjo', 'AppleMyungjo', 'NanumGothicEmbedded', 'CircledFallbackEmbedded', serif;
  --gt: 'Nanum Gothic', 'NanumGothicEmbedded', 'Apple SD Gothic Neo', 'CircledFallbackEmbedded', sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
body { margin: 0; font-family: var(--en); font-size: 10pt; line-height: 1.36; color: #000; background: #fff; }
@media screen {
  body { width: 188mm; margin: 8mm auto; }
  .cols { column-count: 1 !important; column-rule: none !important; width: 90.5mm; margin: 0 auto; }
}
.head { display: grid; grid-template-columns: 32% 1fr 24%; border: 1.3px solid #000; margin-bottom: 3mm; }
.head.qr4 { grid-template-columns: 28% 1fr 22% 25mm; }
.head > div { padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.head .l { border-right: 1px solid #000; text-align: center; font-family: var(--gt); font-size: 9.5pt; line-height: 1.5; }
.head .c { text-align: center; font-family: var(--gt); font-weight: 700; font-size: 16pt; letter-spacing: .02em; line-height: 1.25; word-break: keep-all; }
.head .c.long { font-size: 12.5pt; }
.head .c small { display: block; font-size: 8.8pt; font-weight: 400; margin-top: 1mm; letter-spacing: 0; }
.head .r { border-left: 1px solid #000; text-align: center; font-family: var(--gt); font-size: 8.4pt; line-height: 1.45; }
.head .r .rs { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; word-break: keep-all; }
.head .qr { border-left: 1px solid #000; align-items: center; padding: 1.5mm; }
.head .qr img { width: 20mm; height: 20mm; }
.head .qr span { font-family: var(--gt); font-size: 6.5pt; font-weight: 700; margin-top: .6mm; white-space: nowrap; }
.name { display: flex; gap: 6mm; justify-content: flex-end; align-items: flex-end; font-family: var(--gt); font-size: 9pt; margin: -1mm 0 2.5mm; }
.name span { border-bottom: 1px solid #000; min-width: 28mm; display: inline-block; font-size: 11pt; font-weight: 700; text-align: center; }
.notice { border: 1px solid #000; padding: 1.5mm 3mm; font-family: var(--gt); font-size: 8.3pt; line-height: 1.55; margin-bottom: 3mm; break-inside: avoid; }
.notice b { display: block; text-align: center; margin-bottom: .5mm; }
.cols { column-count: 2; column-gap: 7mm; column-rule: .8px solid #000; column-fill: auto; }
.sec { display: block; width: 32mm; margin: 1mm auto 3mm; text-align: center; font-family: var(--gt); font-weight: 700; font-size: 10.5pt; background: #d9d9d9; border: 1px solid #555; padding: 1mm 0; break-after: avoid; }
.grp { font-family: var(--gt); font-size: 9.6pt; font-weight: 700; margin: 2mm 0 1.5mm; break-after: avoid; }
.q { margin-bottom: 4.2mm; }
.ch, .given, .bogi, .cond, .lines, .graph, .bltab { break-inside: avoid; }
.qh { break-after: avoid; font-family: var(--ko); font-size: 10pt; line-height: 1.5; margin-bottom: 1.5mm; }
.qh .no { font-family: var(--en); font-style: italic; font-weight: 700; font-size: 12pt; margin-right: 1.2mm; }
.qh .pt { font-family: var(--gt); font-size: 8.6pt; }
.psg { text-align: justify; hyphens: auto; margin: 0 0 1.2mm; }
.psg p { margin: 0; text-indent: 1em; orphans: 3; widows: 3; }
.psg.box { border: 1px solid #000; padding: 1.8mm 2.5mm; text-indent: 0; }
.psg.summary { font-size: 10pt; line-height: 1.9; }
.given { border: 1px solid #000; padding: 1.5mm 2.5mm; margin: 0 0 1.5mm; text-align: justify; }
.graph { margin: 0 0 1.5mm; text-align: center; }
.graph img { max-width: 100%; max-height: 62mm; height: auto; }
.ch { margin: 0; padding: 0; list-style: none; }
.ch li { padding-left: 1.35em; text-indent: -1.35em; margin: .25mm 0; }
.ch.ko li { font-family: var(--ko); font-size: 9.8pt; }
.ch.grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 3mm; }
.ch-inline { font-size: 10.5pt; letter-spacing: 1px; margin-top: .5mm; }
.bogi { border: 1px solid #000; padding: 1.5mm 2.5mm; margin: 2.5mm 0 1.5mm; font-size: 9.8pt; text-align: center; }
.bogi .t { text-align: center; font-family: var(--gt); font-size: 8.8pt; margin: -3.4mm auto 1mm; background: #fff; width: 16mm; }
.bogi .chip { font-weight: 700; }
.cond { border: 1px dashed #000; padding: 1.5mm 2.5mm; margin: 1mm 0 1.5mm; font-family: var(--ko); font-size: 9.4pt; }
.cond .t { font-family: var(--gt); font-weight: 700; font-size: 8.8pt; }
.cond ol { margin: .5mm 0 0 0; padding: 0; list-style: none; }
.cond li { padding-left: 1.3em; text-indent: -1.3em; }
.frame { margin: 2mm 0 1mm; font-size: 10pt; line-height: 2; }
.frame .wline { display: inline-block; min-width: 45mm; border-bottom: 1px solid #000; }
.lines { margin-top: 1.5mm; }
.lines div { border-bottom: .7px solid #777; height: 6.8mm; }
.sblank { display: inline-block; min-width: 20mm; border-bottom: 1px solid #000; text-align: center; font-family: var(--gt); font-weight: 700; font-size: 8.8pt; }
.bltab { width: 100%; border-collapse: collapse; margin-top: 1.5mm; font-family: var(--gt); font-size: 9pt; }
.bltab td { border: 1px solid #000; padding: 1.8mm 2mm; }
.bltab .bl-label { width: 13%; text-align: center; font-weight: 700; }
.bltab .bl-write { width: 67%; height: 8mm; }
.bltab .bl-count { width: 20%; text-align: center; }
u { text-decoration-thickness: .8px; text-underline-offset: 2px; }
.end { text-align: center; font-family: var(--gt); font-size: 13pt; font-weight: 700; margin-top: 6mm; }
/* 합본: 학생마다 새 페이지에서 시작 + 홀수페이지 정렬용 빈 페이지(짝수로 끝난 학생 뒤) */
.sheet-break { break-before: page; page-break-before: page; }
.blank-page { break-before: page; page-break-before: page; break-after: page; page-break-after: page; }
/* 정답과 해설 */
.key h1 { font-family: var(--gt); font-size: 15pt; margin: 0 0 1mm; }
.key .sub { font-family: var(--gt); font-size: 9pt; color: #444; margin-bottom: 3mm; }
.ktab { width: 100%; border-collapse: collapse; font-family: var(--gt); font-size: 9pt; margin-bottom: 4mm; table-layout: fixed; }
.ktab td, .ktab th { border: 1px solid #000; text-align: center; padding: 1mm 0; }
.ktab th { background: #eee; font-weight: 700; }
.ktab .sj { font-size: 7.5pt; }
.ex { break-inside: avoid; border-top: .8px solid #999; padding: 2mm 0 2.5mm; font-family: var(--ko); font-size: 9.2pt; line-height: 1.55; }
.ex .h { font-family: var(--gt); font-weight: 700; font-size: 9.6pt; }
.ex .h .tag { font-weight: 400; font-size: 8.3pt; color: #444; margin-left: 2mm; }
.ex .a { font-family: var(--gt); font-weight: 700; }
.ex .model { border: 1px solid #000; padding: 1.5mm 2.5mm; margin: 1mm 0; font-family: var(--en); font-size: 9.6pt; }
/* 휴대폰 미리보기(iframe 폭이 좁을 때) — 머리글을 세로로 쌓고 본문을 화면 폭에 맞춘다. 인쇄에는 영향 없음 */
@media screen and (max-width: 640px) {
  body { width: auto; margin: 4mm 3.5mm; font-size: 10.5pt; }
  .cols { width: auto; }
  .head, .head.qr4 { grid-template-columns: 1fr; }
  .head > div { border-left: 0 !important; border-right: 0 !important; border-bottom: 1px solid #000; }
  .head > div:last-child { border-bottom: 0; }
  .name { justify-content: flex-start; margin-top: 0; white-space: nowrap; }
  .ktab { font-size: 7.5pt; }
}
`;
}

function shell(docTitle: string, css: string, body: string, fontFaceCss?: string, bodyClass = ''): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(docTitle)}</title>
${FONTS_LINK}
<style>
${fontFaceCss ?? ''}
${css}
</style></head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body></html>`;
}

function headerOf(input: FinalExamBuildInput): FinalExamHeader {
  return input.header ?? finalExamHeader({ title: input.title, subtitle: input.subtitle });
}

/** 문제지 한 장 — 합본/단일 공용. breakBefore 면 새 페이지에서 시작. */
function sheetInnerHtml(input: FinalExamBuildInput, breakBefore = false): string {
  const h = headerOf(input);
  const qr = input.qrDataUrl
    ? `<div class="qr"><img src="${input.qrDataUrl}" alt="QR 채점"/><span>${esc(input.qrLabel ?? 'QR 스캔 → 바로 채점')}</span></div>`
    : '';
  const right = h.right.length
    ? `<div class="r">${h.right.length > 1 ? `<b>${esc(h.right[0])}</b><span class="rs">${h.right.slice(1).map(esc).join('<br/>')}</span>` : esc(h.right[0])}</div>`
    : '<div class="r"></div>';
  const head = `<div class="head${qr ? ' qr4' : ''}"><div class="l">${h.left.map(esc).join('<br/>')}</div>`
    + `<div class="c${h.title.length > 14 ? ' long' : ''}">${esc(h.title)}${h.subtitle ? `<small>${esc(h.subtitle)}</small>` : ''}</div>${right}${qr}</div>`
    + `<div class="name">이름 <span>${input.studentName ? esc(input.studentName) : ''}</span> 점수 <span></span></div>`;
  const mc = input.questions.filter((q) => !q.subjective).length;
  const sw = input.questions.length - mc;
  const parts = [mc ? `선택형 ${mc}문항` : '', sw ? `서·논술형 ${sw}문항` : ''].filter(Boolean).join(', ');
  const how = mc && sw
    ? '선택형은 가장 알맞은 답을 하나 고르고, 서·논술형은 조건에 맞게 답을 쓰십시오.'
    : mc ? '가장 알맞은 답을 하나 고르십시오.' : '조건에 맞게 답을 쓰십시오.';
  const notice = `<div class="notice"><b>&lt; 유의 사항 &gt;</b>`
    + `❑ 이 문제지는 ${parts}으로 구성되어 있습니다.<br/>❑ ${how}`
    + `${input.qrDataUrl && mc ? '<br/>❑ 다 푼 뒤 오른쪽 위 QR 을 찍으면 선택형이 바로 채점됩니다.' : ''}</div>`;
  return `<div class="sheet${breakBefore ? ' sheet-break' : ''}">${head}${notice}<div class="cols">${renderQuestionBody(input.questions)}</div></div>`;
}

export function buildFinalExamSheetHtml(input: FinalExamBuildInput): string {
  const title = displayFinalExamTitle(input.title);
  return shell(title, paperCss(title, true), sheetInnerHtml(input), input.fontFaceCss);
}

/**
 * 여러 학생 문제지를 한 PDF 로 합본 — 각 학생이 새 페이지에서 시작하고, 양면 인쇄 시
 * 학생마다 새 용지 앞면(홀수페이지)에서 시작하도록 `blankBefore[i]` 가 true 인 학생 앞에
 * 빈 페이지를 한 장 끼운다. blankBefore 는 호출부에서 각 학생의 실제 페이지 수로 계산한다
 * (Chrome 헤드리스 print 는 `break-before: right` 로 빈 페이지를 만들지 못하므로 직접 삽입).
 * 합본은 쪽 번호가 학생을 넘어 이어지므로 「N쪽 / M쪽」은 찍지 않는다.
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
  const docTitle = displayFinalExamTitle(opts?.docTitle ?? sheets[0]?.title ?? FINAL_EXAM_PRODUCT_NAME);
  return shell(docTitle, paperCss(docTitle, false), body, opts?.fontFaceCss);
}

export function buildFinalExamAnswerHtml(input: FinalExamBuildInput): string {
  const title = displayFinalExamTitle(input.title);
  // 주관식(서술형) 모범답안 — 주제틀 + 모범답안 (있으면), 없으면 correctAnswer
  const modelOf = (q: FinalExamQuestion): string => {
    const ma = (q.modelAnswer ?? q.correctAnswer ?? '').trim();
    if (q.frame && ma && !ma.toLowerCase().startsWith(q.frame.toLowerCase())) return `${q.frame} ${ma}`;
    return ma;
  };
  const tag = (q: FinalExamQuestion) => {
    const serial = fmtFinalSerial(q.serialNo);
    return `<span class="tag">${esc(q.subjective ? `서술·${q.type}` : q.type)} · ${esc(q.sourceKey)}${serial ? ` · ${esc(serial)}` : ''}${q.subjective ? ` · ${pointsOf(q)}점` : ''}</span>`;
  };
  /* 빠른 정답표 — 12문항씩 번호/정답 두 줄. 주관식은 「서술」 */
  const rows: string[] = [];
  for (let i = 0; i < input.questions.length; i += 12) {
    const ch = input.questions.slice(i, i + 12);
    const pad = '<td></td>'.repeat(12 - ch.length);
    rows.push(
      `<tr><th>번호</th>${ch.map((q) => `<th>${q.num}</th>`).join('')}${pad.replace(/td/g, 'th')}</tr>`
      + `<tr><td>정답</td>${ch.map((q) => (q.subjective ? '<td class="sj">서술</td>' : `<td>${esc(q.correctAnswer)}</td>`)).join('')}${pad}</tr>`,
    );
  }
  const ex = input.questions.map((q) =>
    q.subjective
      ? `<div class="ex"><div class="h">${q.num}. 모범답안${tag(q)}</div><div class="model">${escKeepUnderline(modelOf(q) || '(모범답안 없음)')}</div>${q.explanation ? richText(q.explanation) : ''}</div>`
      : `<div class="ex"><div class="h">${q.num}. <span class="a">${esc(q.correctAnswer)}</span>${tag(q)}</div>${richText(q.explanation || '해설이 제공되지 않은 문항입니다.')}</div>`,
  );
  const mc = input.questions.filter((q) => !q.subjective).length;
  const sw = input.questions.length - mc;
  const body = `<h1>${esc(title)} — 정답과 해설</h1>`
    + `<div class="sub">${[input.subtitle, `선택형 ${mc}문항${sw ? ` · 서·논술형 ${sw}문항` : ''}`, '문항별 유형·출처·고유번호'].filter(Boolean).map((s) => esc(String(s))).join(' · ')}</div>`
    + `<table class="ktab">${rows.join('')}</table><div class="cols">${ex.join('')}</div>`;
  return shell(`${title} — 정답과 해설`, paperCss(`${title} 정답과 해설`, true), body, input.fontFaceCss, 'key');
}
