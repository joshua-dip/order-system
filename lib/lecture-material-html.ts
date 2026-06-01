/**
 * 강의용자료 — "한 지문 = 한 화면" 강의/판서용 자료 (페이퍼릭 톤).
 *
 * gangui_kit 디자인 기반:
 *   - 페이퍼릭 그린 그라데이션 헤더 카드 (kicker / title / 워터마크 문항번호)
 *   - 문장 앞 작은 초록 위첨자 번호 + 한 단락 (곧은 따옴표 → 둥근 따옴표)
 *   - Pretendard 폰트, container-query(cqw) 기반 비례 확대 (전자칠판/프로젝터)
 *   - 줄간격 넓게(판서 공간), 길면 글자 크기 auto-fit 으로 한 화면에 맞춤
 *
 * 클라이언트에서 srcDoc(iframe) 미리보기 + 새 창(프로젝터) + 인쇄로 사용.
 */

export interface LectureSentence {
  idx: number;
  text: string;
}

export interface BuildLectureMaterialOptions {
  /** 카테고리 라벨. 기본 "강의용자료". */
  kicker?: string;
  /** 시험정보 (예: 26년 고3 5월 영어모의고사). */
  title?: string;
  /** 헤더 오른쪽 워터마크 문항번호 (예: 21). */
  number?: string;
  sentences: LectureSentence[];
  /** 본문 줄 간격(line-height). 판서 공간 조절. 기본 2.6, 범위 1.4~3.6. */
  lineHeight?: number;
}

/** line-height 안전 범위로 보정. */
export function clampLineHeight(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return 2.6;
  return Math.min(3.6, Math.max(1.4, Math.round(n * 10) / 10));
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 곧은 따옴표 → 둥근 따옴표 (조판 품질). */
function smartQuote(s: string): string {
  return String(s ?? '').replace(/'/g, '’');
}

const LECTURE_CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
:root{
  --g1:#34D399; --g2:#10B981; --g3:#0D9488;
  --accent:#059669; --ink:#0F172A; --sub:#64748B;
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
  max-width:780px;
  min-height:100vh;
  container-type:inline-size;
  display:flex;
  flex-direction:column;
  padding:3.4cqw 4.4cqw 4cqw;
}
.head{
  position:relative;
  overflow:hidden;
  border-radius:1cqw;
  padding:1.5cqw 3cqw;
  background:linear-gradient(135deg,var(--g1) 0%,var(--g2) 52%,var(--g3) 100%);
  box-shadow:0 0.45cqw 1.4cqw rgba(13,148,136,0.30);
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.kicker{position:relative;z-index:1;color:rgba(255,255,255,0.88);font-weight:600;font-size:1.55cqw;letter-spacing:0.04em;}
.title{position:relative;z-index:1;color:#fff;font-weight:700;font-size:2.7cqw;letter-spacing:-0.015em;margin-top:0.3cqw;}
.wm{position:absolute;right:1.6cqw;top:50%;transform:translateY(-46%);font-size:7cqw;font-weight:800;line-height:1;color:rgba(255,255,255,0.18);z-index:0;user-select:none;}
.passage{
  margin-top:3cqw;
  color:var(--ink);
  font-family:'Pretendard',sans-serif;
  font-size:calc(1.6cqw * var(--s,1));
  font-weight:400;
  line-height:2.6;
  text-align:justify;
  text-justify:inter-word;
}
.n{font-size:0.56em;font-weight:700;color:var(--accent);vertical-align:0.42em;margin-left:0.55em;margin-right:0.18em;letter-spacing:0.02em;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.n.first{margin-left:0;}
.empty{margin-top:3cqw;color:var(--sub);font-size:1.8cqw;}
@media print{
  @page{size:A4;margin:0;}
  html,body{height:auto;}
  .page{min-height:auto;}
}
`;

/** 길어도 한 화면을 넘지 않게: 넘칠 때만 글자 크기를 줄이는 auto-fit 스크립트. */
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

function passageHtml(sentences: LectureSentence[], lineHeight: number): string {
  const list = (sentences || []).map(s => (s?.text ?? '').trim()).filter(Boolean);
  if (list.length === 0) {
    return '<p class="empty">지문이 없습니다. 지문을 불러오세요.</p>';
  }
  const inner = list
    .map((t, i) => `<span class="n${i === 0 ? ' first' : ''}">${i + 1}</span>${smartQuote(escapeHtml(t))}`)
    .join('');
  return `<p class="passage" id="passage" style="line-height:${lineHeight}">${inner}</p>`;
}

export function buildLectureMaterialHtml(opts: BuildLectureMaterialOptions): string {
  const kicker = (opts.kicker || '강의용자료').trim();
  const title = (opts.title || '').trim();
  const number = (opts.number || '').trim();
  const lineHeight = clampLineHeight(opts.lineHeight);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title || kicker)}</title>
<style>${LECTURE_CSS}</style></head>
<body>
<div class="page" id="page">
  <header class="head">
    <div class="kicker">${escapeHtml(kicker)}</div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="wm">${escapeHtml(number)}</div>
  </header>
  ${passageHtml(opts.sentences, lineHeight)}
</div>
<script>${FIT_SCRIPT}</script>
</body></html>`;
}
