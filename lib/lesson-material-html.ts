/**
 * 수업용자료 — "한 지문" 수업용 자료 (페이퍼릭 그린 톤, 강의용자료와 통일).
 *
 * 4가지 모드(영어/한국어 문장 쌍을 다르게 배치):
 *   - parallel   영한대조 : 영어(좌) + 한국어(우) 2단 — 한 화면(가로) 참고용
 *   - lineByLine 한줄해석 : 문장별 [영어 → 바로 아래 한국어] 한 줄씩 (세로)
 *   - writeEn    영작하기 : 한국어 제시 → 빈 줄에 영어 작성 (세로 워크시트)
 *   - writeKo    해석쓰기 : 영어 제시 → 빈 줄에 한국어 해석 작성 (세로 워크시트)
 *
 * 공통: 강의용자료와 동일한 그린 그라데이션 헤더 카드(kicker/title/워터마크 번호),
 *       Pretendard(영어)+Nanum Pen Script(한국어), 줄 간격 조절.
 * parallel 은 한 화면(가로) auto-fit, 나머지는 자연 흐름(세로, 다중 페이지 가능).
 *
 * 클라이언트에서 srcDoc(iframe) 미리보기 + 새 창 + 인쇄 + 서버 PDF.
 */

import { clampLineHeight } from './lecture-material-html';

export { clampLineHeight };

export type LessonMode = 'parallel' | 'lineByLine' | 'writeEn' | 'writeKo';

export const LESSON_MODES: LessonMode[] = ['parallel', 'lineByLine', 'writeEn', 'writeKo'];
export const LESSON_MODE_LABELS: Record<LessonMode, string> = {
  parallel: '수업용자료',
  lineByLine: '한줄해석',
  writeEn: '영작하기',
  writeKo: '해석쓰기',
};

export function normalizeLessonMode(v: unknown): LessonMode {
  return (LESSON_MODES as string[]).includes(String(v)) ? (v as LessonMode) : 'parallel';
}

/** 한줄해석 레이아웃: 위아래(stack) / 좌우(side). */
export type LineLayout = 'stack' | 'side';
export function normalizeLineLayout(v: unknown): LineLayout {
  return v === 'side' ? 'side' : 'stack';
}

// ── 글씨체 ──────────────────────────────────────────────────────────────────
export type EnFontKey = 'sans' | 'serif' | 'rounded';
export type KoFontKey =
  | 'pen'
  | 'gaegu'
  | 'sans'
  | 'serif'
  | 'jua'
  | 'dohyeon'
  | 'gugi'
  | 'hi-melody'
  | 'poor-story'
  | 'gowun-dodum'
  | 'nanum-myeongjo'
  | 'black-han-sans';

export const EN_FONT_OPTIONS: { key: EnFontKey; label: string }[] = [
  { key: 'sans', label: '고딕(Pretendard)' },
  { key: 'serif', label: '명조(Serif)' },
  { key: 'rounded', label: '둥근(Comic)' },
];
export const KO_FONT_OPTIONS: { key: KoFontKey; label: string }[] = [
  { key: 'pen', label: '손글씨(펜)' },
  { key: 'gaegu', label: '손글씨(가람)' },
  { key: 'hi-melody', label: '손글씨(멜로디)' },
  { key: 'poor-story', label: '손글씨(일기체)' },
  { key: 'gugi', label: '캘리(붓글씨)' },
  { key: 'jua', label: '둥근(주아체)' },
  { key: 'gowun-dodum', label: '둥근 돋움(고운)' },
  { key: 'dohyeon', label: '굵은 돋움(도현)' },
  { key: 'black-han-sans', label: '포스터(검은한글)' },
  { key: 'sans', label: '고딕(Pretendard)' },
  { key: 'nanum-myeongjo', label: '명조(나눔)' },
  { key: 'serif', label: '명조(Noto Serif)' },
];

const EN_FONT_STACK: Record<EnFontKey, string> = {
  sans: "'Pretendard','Malgun Gothic',sans-serif",
  serif: "'Times New Roman','Georgia',serif",
  rounded: "'Comic Sans MS','Chalkboard SE','Pretendard',sans-serif",
};
const KO_FONT_STACK: Record<KoFontKey, string> = {
  pen: "'Nanum Pen Script','Pretendard',sans-serif",
  gaegu: "'Gaegu','Pretendard',sans-serif",
  sans: "'Pretendard','Malgun Gothic',sans-serif",
  serif: "'Noto Serif KR','Pretendard',serif",
  jua: "'Jua','Pretendard',sans-serif",
  dohyeon: "'Do Hyeon','Pretendard',sans-serif",
  gugi: "'Gugi','Pretendard',sans-serif",
  'hi-melody': "'Hi Melody','Pretendard',sans-serif",
  'poor-story': "'Poor Story','Pretendard',sans-serif",
  'gowun-dodum': "'Gowun Dodum','Pretendard',sans-serif",
  'nanum-myeongjo': "'Nanum Myeongjo','Pretendard',serif",
  'black-han-sans': "'Black Han Sans','Pretendard',sans-serif",
};

const KO_FONT_KEYS: KoFontKey[] = Object.keys(KO_FONT_STACK) as KoFontKey[];

export function normalizeEnFont(v: unknown): EnFontKey {
  return v === 'serif' || v === 'rounded' ? v : 'sans';
}
export function normalizeKoFont(v: unknown): KoFontKey {
  return (KO_FONT_KEYS as string[]).includes(String(v)) ? (v as KoFontKey) : 'pen';
}
/** 글자 크기 배율 (0.7~1.6, 기본 1.0). enFontScale·koFontScale 공용. */
export function clampFontScale(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.6, Math.max(0.7, Math.round(n * 100) / 100));
}

/** parallel 만 가로(landscape), 나머지는 세로(portrait). */
export function lessonModeIsLandscape(mode?: LessonMode): boolean {
  return normalizeLessonMode(mode) === 'parallel';
}

export interface LessonSentencePair {
  idx: number;
  en: string;
  ko?: string;
}

export interface BuildLessonMaterialOptions {
  /** 카테고리 라벨. 기본 "수업용자료". */
  kicker?: string;
  /** 시험정보 (예: 26년 고3 5월 영어모의고사). */
  title?: string;
  /** 헤더 오른쪽 워터마크 문항번호 (예: 18). */
  number?: string;
  sentences: LessonSentencePair[];
  /** 모드. 기본 'parallel'. */
  mode?: LessonMode;
  /** 본문 줄 간격(line-height) / 작성 줄 높이. 기본 2.6. */
  lineHeight?: number;
  /** parallel 좌측 영어 칼럼 폭(%) = 구분선 위치. 기본 60, 범위 30~75. */
  splitPct?: number;
  /** lineByLine 레이아웃: 위아래(stack, 기본) / 좌우(side). */
  lineLayout?: LineLayout;
  /** 영어 글씨체. 기본 'sans'. */
  enFont?: EnFontKey;
  /** 한국어 글씨체. 기본 'pen'(손글씨). */
  koFont?: KoFontKey;
  /** 영어 글자 크기 배율(0.7~1.6). 미지정 시 fontScale → 1.0. */
  enFontScale?: number;
  /** 한국어 글자 크기 배율(0.7~1.6). 미지정 시 fontScale → 1.0. */
  koFontScale?: number;
  /** [Deprecated] 영·한 공용 배율. enFontScale/koFontScale 둘 다 미지정일 때만 사용. */
  fontScale?: number;
}

/** 구분선(영어 칼럼 폭) 안전 범위로 보정. */
export function clampSplitPct(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return 60;
  return Math.min(75, Math.max(30, Math.round(n)));
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 곧은 따옴표 → 둥근 따옴표. */
function smartQuote(s: string): string {
  return String(s ?? '').replace(/'/g, '’');
}

/** 작성란 줄 수 추정 (목표 텍스트 길이 기준, 1~3줄). */
function writeRows(target: string): number {
  const len = (target ?? '').trim().length;
  return Math.min(3, Math.max(1, Math.round(len / 55) || 1));
}

function lessonCss(landscape: boolean, pageMax: number, lineHeight: number): string {
  // 강의용자료와 동일한 그린 헤더 톤. 패딩·폰트 크기를 lecture-material-html.ts 와 1:1 일치.
  const headPad = '1.5cqw 3cqw';
  const kickerFs = '1.55cqw';
  const titleFs = '2.7cqw';
  const wmFs = '7cqw';
  const pagePad = landscape ? '2.6cqw 3.4cqw 3cqw' : '3.4cqw 4.4cqw 4cqw';
  return `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
@import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gaegu:wght@400;700&family=Gowun+Dodum&family=Gugi&family=Hi+Melody&family=Jua&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Noto+Serif+KR:wght@400;600&family=Poor+Story&display=swap');
:root{
  --g1:#34D399; --g2:#10B981; --g3:#0D9488;
  --accent:#059669; --ink:#0F172A; --ko:#334155; --sub:#64748B;
}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;}
body{
  background:#FFFFFF;
  display:flex;
  justify-content:center;
  font-family:'Pretendard','Malgun Gothic',sans-serif;
  -webkit-font-smoothing:antialiased;
}
.page{
  width:100%;
  max-width:${pageMax}px;
  ${landscape ? 'min-height:100vh;' : ''}
  container-type:inline-size;
  display:flex;
  flex-direction:column;
  padding:${pagePad};
}
/* ---- 헤더 (강의용자료와 동일한 그린 그라데이션 카드) ---- */
/* flex-shrink:0 — .page(display:flex column, min-height:100vh) 안에서
   본문이 길 때 헤더가 압축되면서 overflow:hidden 으로 제목 글자가 잘리는 것 차단. */
.head{
  position:relative;
  overflow:hidden;
  border-radius:1cqw;
  padding:${headPad};
  background:linear-gradient(135deg,var(--g1) 0%,var(--g2) 52%,var(--g3) 100%);
  box-shadow:0 0.45cqw 1.4cqw rgba(13,148,136,0.30);
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  flex:0 0 auto;
}
.kicker{position:relative;z-index:1;color:rgba(255,255,255,0.88);font-weight:600;font-size:${kickerFs};letter-spacing:0.04em;}
.title{position:relative;z-index:1;color:#fff;font-weight:700;font-size:${titleFs};letter-spacing:-0.015em;margin-top:0.3cqw;}
.wm{position:absolute;right:1.6cqw;top:50%;transform:translateY(-46%);font-size:${wmFs};font-weight:800;line-height:1;color:rgba(255,255,255,0.18);z-index:0;user-select:none;}
/* ---- parallel: 2단 (영어 좌 · 한국어 우) ---- */
.cols{margin-top:2.2cqw;display:flex;gap:3cqw;align-items:flex-start;}
.col-en{flex:0 0 var(--split,60%);min-width:0;}
.col-ko{flex:1 1 0;min-width:0;padding-left:2.6cqw;border-left:0.3cqw solid #A7F3D0;}
.en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.5cqw * var(--s,1) * var(--en-fs,1));font-weight:400;line-height:2.6;text-align:justify;text-justify:inter-word;}
.ko{color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.0cqw * var(--s,1) * var(--ko-fs,1));line-height:1.6;text-align:justify;word-break:keep-all;}
.ko-empty{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.5cqw;}
/* ---- 세로 리스트 (한줄해석 / 영작 / 해석쓰기) ---- */
.list{margin-top:2cqw;}
.item{display:flex;gap:1.6cqw;padding:1.1cqw 0;border-bottom:0.12cqw dotted #d8dee6;}
.item:last-child{border-bottom:0;}
.inum{flex:0 0 auto;min-width:3.2cqw;color:var(--accent);font-weight:800;font-size:1.7cqw;font-family:'Pretendard',sans-serif;}
.ibody{flex:1;min-width:0;}
.l-en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.95cqw * var(--en-fs,1));line-height:1.45;text-align:justify;text-justify:inter-word;}
.l-ko{color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.25cqw * var(--ko-fs,1));line-height:1.35;margin-top:0.5cqw;word-break:keep-all;}
/* 한줄해석 좌우 레이아웃 */
.lr{display:flex;gap:2cqw;align-items:flex-start;}
.lr-en{flex:1 1 50%;min-width:0;color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.85cqw * var(--en-fs,1));line-height:1.45;text-align:justify;text-justify:inter-word;}
.lr-ko{flex:1 1 50%;min-width:0;color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.15cqw * var(--ko-fs,1));line-height:1.35;word-break:keep-all;border-left:0.2cqw solid #A7F3D0;padding-left:1.6cqw;}
.lr-ko.ko-miss{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.6cqw;}
.p-ko{color:var(--ink);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.3cqw * var(--ko-fs,1));line-height:1.35;word-break:keep-all;}
.p-en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.95cqw * var(--en-fs,1));line-height:1.45;text-align:justify;}
.ko-miss{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.6cqw;margin-top:0.4cqw;}
.wlines{margin-top:0.7cqw;}
.wline{border-bottom:0.13cqw solid #9aa6b2;height:calc(${lineHeight} * 1.3cqw);}
.empty{margin-top:3cqw;color:var(--sub);font-size:1.8cqw;}
@media print{
  @page{size:A4${landscape ? ' landscape' : ''};margin:${landscape ? '0' : '10mm'};}
  html,body{height:auto;}
  .page{min-height:auto;${landscape ? '' : 'padding-left:0;padding-right:0;'}}
  .item{page-break-inside:avoid;}
}
`;
}

/** parallel 만 한 화면 auto-fit. */
const FIT_SCRIPT = `
(function(){
  function fit(){
    var page=document.getElementById('page');
    if(!page) return;
    var s=1; page.style.setProperty('--s',s);
    var guard=0;
    while(page.scrollHeight>window.innerHeight+1 && s>0.5 && guard<120){
      s-=0.02; guard++; page.style.setProperty('--s',s);
    }
  }
  window.addEventListener('resize',fit);
  window.addEventListener('load',fit);
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(fit);}
  fit();
})();
`;

function parallelBody(pairs: LessonSentencePair[], lineHeight: number, splitPct: number): string {
  const enText = pairs.map(s => smartQuote(escapeHtml(s.en.trim()))).join(' ');
  const koList = pairs.map(s => (s.ko ?? '').trim()).filter(Boolean);
  const koText = koList.length ? escapeHtml(koList.join(' ')) : '';
  return `<div class="cols" style="--split:${splitPct}%">
    <div class="col-en"><p class="en" style="line-height:${lineHeight}">${enText}</p></div>
    <div class="col-ko">${koText ? `<p class="ko">${koText}</p>` : '<p class="ko-empty">(해석 없음)</p>'}</div>
  </div>`;
}

function lineByLineBody(pairs: LessonSentencePair[], layout: LineLayout): string {
  const side = layout === 'side';
  const items = pairs
    .map((s, i) => {
      const en = smartQuote(escapeHtml(s.en.trim()));
      const ko = (s.ko ?? '').trim();
      if (side) {
        const koCell = ko
          ? `<div class="lr-ko">${escapeHtml(ko)}</div>`
          : '<div class="lr-ko ko-miss">(해석 없음)</div>';
        return `<div class="item"><div class="inum">${i + 1}</div><div class="ibody"><div class="lr"><div class="lr-en">${en}</div>${koCell}</div></div></div>`;
      }
      const koHtml = ko ? `<div class="l-ko">${escapeHtml(ko)}</div>` : '<div class="ko-miss">(해석 없음)</div>';
      return `<div class="item"><div class="inum">${i + 1}</div><div class="ibody"><div class="l-en">${en}</div>${koHtml}</div></div>`;
    })
    .join('\n');
  return `<div class="list">${items}</div>`;
}

function wlines(n: number): string {
  return `<div class="wlines">${Array.from({ length: n }, () => '<div class="wline"></div>').join('')}</div>`;
}

function writeEnBody(pairs: LessonSentencePair[]): string {
  // 한국어 제시 → 영어 작성
  const items = pairs
    .map((s, i) => {
      const ko = (s.ko ?? '').trim();
      const prompt = ko ? `<div class="p-ko">${escapeHtml(ko)}</div>` : `<div class="ko-miss">(해석 없음 — 영어 원문: ${smartQuote(escapeHtml(s.en.trim()))})</div>`;
      return `<div class="item"><div class="inum">${i + 1}</div><div class="ibody">${prompt}${wlines(writeRows(s.en))}</div></div>`;
    })
    .join('\n');
  return `<div class="list">${items}</div>`;
}

function writeKoBody(pairs: LessonSentencePair[]): string {
  // 영어 제시 → 한국어 해석 작성
  const items = pairs
    .map((s, i) => {
      const en = smartQuote(escapeHtml(s.en.trim()));
      return `<div class="item"><div class="inum">${i + 1}</div><div class="ibody"><div class="p-en">${en}</div>${wlines(writeRows(s.ko || s.en))}</div></div>`;
    })
    .join('\n');
  return `<div class="list">${items}</div>`;
}

/** 다 페이지 PDF (지문×N): parallel 은 페이지마다 A4 landscape per-page autofit,
 *  나머지 모드(lineByLine·writeEn·writeKo)는 page-break-after 로 지문 사이만 분리하고
 *  본문은 자연 흐름(긴 지문은 자동으로 2~3쪽). */
export interface LessonMultiPageItem {
  /** 시험정보 라벨 (예: 26년 고3 5월 영어모의고사). */
  title?: string;
  /** 헤더 오른쪽 워터마크 (예: 18). */
  number?: string;
  sentences: LessonSentencePair[];
}

export interface BuildLessonMaterialMultiPageOptions {
  /** 모든 페이지 공통 카테고리. 모드 라벨 자동 적용을 원하면 호출자가 결정. */
  kicker?: string;
  items: LessonMultiPageItem[];
  mode?: LessonMode;
  lineHeight?: number;
  splitPct?: number;
  lineLayout?: LineLayout;
  enFont?: EnFontKey;
  koFont?: KoFontKey;
  enFontScale?: number;
  koFontScale?: number;
}

/** parallel 모드 다 페이지: 페이지마다 A4 landscape fixed-size + per-page autofit. */
const MULTI_FIT_SCRIPT_PARALLEL = `
(function(){
  function fitOne(page){
    var s=1; page.style.setProperty('--s',s);
    var guard=0;
    while(page.scrollHeight>page.clientHeight+1 && s>0.5 && guard<120){
      s-=0.02; guard++;
      page.style.setProperty('--s',s);
    }
  }
  function fitAll(){
    document.querySelectorAll('.page-multi').forEach(fitOne);
  }
  window.addEventListener('load', fitAll);
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(fitAll); }
  fitAll();
})();
`;

function lessonMultiCss(landscape: boolean, lineHeight: number): string {
  // parallel(landscape): 페이지마다 297mm × 210mm fixed-size container
  // 그 외: page-multi 는 width 만 잡고 height auto + page-break-after
  const pageDims = landscape
    ? `width:297mm;height:210mm;overflow:hidden;container-type:inline-size;padding:2.6cqw 3.4cqw 3cqw;`
    : `width:210mm;container-type:inline-size;padding:3.4cqw 4.4cqw 4cqw;`;
  return `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
@import url('https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Gaegu:wght@400;700&family=Gowun+Dodum&family=Gugi&family=Hi+Melody&family=Jua&family=Nanum+Myeongjo:wght@400;700&family=Nanum+Pen+Script&family=Noto+Serif+KR:wght@400;600&family=Poor+Story&display=swap');
:root{
  --g1:#34D399; --g2:#10B981; --g3:#0D9488;
  --accent:#059669; --ink:#0F172A; --ko:#334155; --sub:#64748B;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{
  background:#FFFFFF;
  font-family:'Pretendard','Malgun Gothic',sans-serif;
  -webkit-font-smoothing:antialiased;
}
.page-multi{
  ${pageDims}
  page-break-after:always;
}
.page-multi:last-of-type{page-break-after:auto;}
/* 헤더 — 강의용자료·단건 수업용자료와 동일한 비율, flex-shrink:0 으로 압축 차단. */
.head{
  position:relative;
  overflow:hidden;
  border-radius:1cqw;
  padding:1.5cqw 3cqw;
  background:linear-gradient(135deg,var(--g1) 0%,var(--g2) 52%,var(--g3) 100%);
  box-shadow:0 0.45cqw 1.4cqw rgba(13,148,136,0.30);
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  flex:0 0 auto;
}
.kicker{position:relative;z-index:1;color:rgba(255,255,255,0.88);font-weight:600;font-size:1.55cqw;letter-spacing:0.04em;}
.title{position:relative;z-index:1;color:#fff;font-weight:700;font-size:2.7cqw;letter-spacing:-0.015em;margin-top:0.3cqw;}
.wm{position:absolute;right:1.6cqw;top:50%;transform:translateY(-46%);font-size:7cqw;font-weight:800;line-height:1;color:rgba(255,255,255,0.18);z-index:0;user-select:none;}
/* parallel */
.cols{margin-top:2.2cqw;display:flex;gap:3cqw;align-items:flex-start;}
.col-en{flex:0 0 var(--split,60%);min-width:0;}
.col-ko{flex:1 1 0;min-width:0;padding-left:2.6cqw;border-left:0.3cqw solid #A7F3D0;}
.en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.5cqw * var(--s,1) * var(--en-fs,1));font-weight:400;line-height:2.6;text-align:justify;text-justify:inter-word;}
.ko{color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.0cqw * var(--s,1) * var(--ko-fs,1));line-height:1.6;text-align:justify;word-break:keep-all;}
.ko-empty{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.5cqw;}
/* 세로 (한줄해석/영작/해석쓰기) */
.list{margin-top:2cqw;}
.item{display:flex;gap:1.6cqw;padding:1.1cqw 0;border-bottom:0.12cqw dotted #d8dee6;page-break-inside:avoid;}
.item:last-child{border-bottom:0;}
.inum{flex:0 0 auto;min-width:3.2cqw;color:var(--accent);font-weight:800;font-size:1.7cqw;font-family:'Pretendard',sans-serif;}
.ibody{flex:1;min-width:0;}
.l-en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.95cqw * var(--en-fs,1));line-height:1.45;text-align:justify;text-justify:inter-word;}
.l-ko{color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.25cqw * var(--ko-fs,1));line-height:1.35;margin-top:0.5cqw;word-break:keep-all;}
.lr{display:flex;gap:2cqw;align-items:flex-start;}
.lr-en{flex:1 1 50%;min-width:0;color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.85cqw * var(--en-fs,1));line-height:1.45;text-align:justify;text-justify:inter-word;}
.lr-ko{flex:1 1 50%;min-width:0;color:var(--ko);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.15cqw * var(--ko-fs,1));line-height:1.35;word-break:keep-all;border-left:0.2cqw solid #A7F3D0;padding-left:1.6cqw;}
.lr-ko.ko-miss{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.6cqw;}
.p-ko{color:var(--ink);font-family:var(--ko-font,'Nanum Pen Script',sans-serif);font-size:calc(2.3cqw * var(--ko-fs,1));line-height:1.35;word-break:keep-all;}
.p-en{color:var(--ink);font-family:var(--en-font,'Pretendard',sans-serif);font-size:calc(1.95cqw * var(--en-fs,1));line-height:1.45;text-align:justify;}
.ko-miss{color:#cbd5e1;font-family:'Pretendard',sans-serif;font-size:1.6cqw;margin-top:0.4cqw;}
.wlines{margin-top:0.7cqw;}
.wline{border-bottom:0.13cqw solid #9aa6b2;height:calc(${lineHeight} * 1.3cqw);}
@media print{
  @page{size:A4${landscape ? ' landscape' : ''};margin:${landscape ? '0' : '10mm'};}
}
`;
}

export function buildLessonMaterialMultiPageHtml(opts: BuildLessonMaterialMultiPageOptions): string {
  const kicker = (opts.kicker || '수업용자료').trim();
  const items = Array.isArray(opts.items) ? opts.items : [];
  const lineHeight = clampLineHeight(opts.lineHeight);
  const splitPct = clampSplitPct(opts.splitPct);
  const lineLayout = normalizeLineLayout(opts.lineLayout);
  const enFontStack = EN_FONT_STACK[normalizeEnFont(opts.enFont)];
  const koFontStack = KO_FONT_STACK[normalizeKoFont(opts.koFont)];
  const legacyScale = 1;
  const enFontScale =
    opts.enFontScale !== undefined ? clampFontScale(opts.enFontScale) : legacyScale;
  const koFontScale =
    opts.koFontScale !== undefined ? clampFontScale(opts.koFontScale) : legacyScale;
  const mode = normalizeLessonMode(opts.mode);
  const landscape = lessonModeIsLandscape(mode);

  const pagesHtml = items
    .map((it) => {
      const title = (it.title || '').trim();
      const number = (it.number || '').trim();
      const pairs = (it.sentences || []).filter((s) => (s?.en ?? '').trim());
      let body: string;
      if (pairs.length === 0) {
        body = '<p class="empty">지문이 없습니다.</p>';
      } else if (mode === 'parallel') {
        body = parallelBody(pairs, lineHeight, splitPct);
      } else if (mode === 'lineByLine') {
        body = lineByLineBody(pairs, lineLayout);
      } else if (mode === 'writeEn') {
        body = writeEnBody(pairs);
      } else {
        body = writeKoBody(pairs);
      }
      return `<div class="page-multi" style="--split:${splitPct}%">
  <header class="head">
    <div class="kicker">${escapeHtml(kicker)}</div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="wm">${escapeHtml(number)}</div>
  </header>
  ${body}
</div>`;
    })
    .join('\n');

  const fitScript = landscape ? `<script>${MULTI_FIT_SCRIPT_PARALLEL}</script>` : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(kicker)}</title>
<style>${lessonMultiCss(landscape, lineHeight)}</style></head>
<body style="--en-font:${enFontStack};--ko-font:${koFontStack};--en-fs:${enFontScale};--ko-fs:${koFontScale}">
${pagesHtml}
${fitScript}
</body></html>`;
}

export function buildLessonMaterialHtml(opts: BuildLessonMaterialOptions): string {
  const kicker = (opts.kicker || '수업용자료').trim();
  const title = (opts.title || '').trim();
  const number = (opts.number || '').trim();
  const lineHeight = clampLineHeight(opts.lineHeight);
  const splitPct = clampSplitPct(opts.splitPct);
  const lineLayout = normalizeLineLayout(opts.lineLayout);
  const enFontStack = EN_FONT_STACK[normalizeEnFont(opts.enFont)];
  const koFontStack = KO_FONT_STACK[normalizeKoFont(opts.koFont)];
  // EN/KO 배율 분리. 둘 다 미지정이면 fontScale(레거시)로 폴백.
  const legacyScale = clampFontScale(opts.fontScale);
  const enFontScale =
    opts.enFontScale !== undefined ? clampFontScale(opts.enFontScale) : legacyScale;
  const koFontScale =
    opts.koFontScale !== undefined ? clampFontScale(opts.koFontScale) : legacyScale;
  const mode = normalizeLessonMode(opts.mode);
  const landscape = lessonModeIsLandscape(mode);
  const pageMax = landscape ? 1040 : 820;

  const pairs = (opts.sentences || []).filter(s => (s?.en ?? '').trim());
  let body: string;
  if (pairs.length === 0) {
    body = '<p class="empty">지문이 없습니다. 지문을 불러오세요.</p>';
  } else if (mode === 'parallel') {
    body = parallelBody(pairs, lineHeight, splitPct);
  } else if (mode === 'lineByLine') {
    body = lineByLineBody(pairs, lineLayout);
  } else if (mode === 'writeEn') {
    body = writeEnBody(pairs);
  } else {
    body = writeKoBody(pairs);
  }

  const fitScript = landscape ? `<script>${FIT_SCRIPT}</script>` : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title || kicker)}</title>
<style>${lessonCss(landscape, pageMax, lineHeight)}</style></head>
<body>
<div class="page" id="page" style="--en-font:${enFontStack};--ko-font:${koFontStack};--en-fs:${enFontScale};--ko-fs:${koFontScale}">
  <header class="head">
    <div class="kicker">${escapeHtml(kicker)}</div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="wm">${escapeHtml(number)}</div>
  </header>
  ${body}
</div>
${fitScript}
</body></html>`;
}
