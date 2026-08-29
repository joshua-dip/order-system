/**
 * 변형문제 인쇄 양식 — 유형별로 한 문서.
 *
 * 2026-08 에 선생님께 나간 자료(수능만만 09회)가 이 모양이었고, 그걸 원하신다.
 * 그때는 화면을 Chrome 「PDF로 저장」으로 뽑은 일회성이라 코드에 남아 있지 않았다.
 * 앞으로 같은 양식으로 계속 낼 수 있게 여기에 고정한다.
 *
 * 한 파일 = 한 유형이다(「글의 순서.pdf」·「문장 삽입.pdf」…). 유형이 섞이면
 * 수업에서 나눠 주기가 번거로워진다.
 */

/** 유형 코드 → 인쇄물에 쓰는 이름. 코드명("순서")을 그대로 찍으면 학생 자료로 어색하다. */
const TYPE_PRINT_NAME: Record<string, string> = {
  순서: '글의 순서',
  삽입: '문장 삽입',
  빈칸: '빈칸 추론',
  요약: '요약문 완성',
  어법: '어법',
  어휘: '어휘',
  함의: '밑줄 함의',
  주제: '글의 주제',
  제목: '글의 제목',
  주장: '필자의 주장',
  일치: '내용 일치',
  불일치: '내용 불일치',
  무관한문장: '무관한 문장',
};

/**
 * 회원별 인쇄 양식 설정 — `users.variantPrintFormat` 에 저장한다.
 *
 * 선생님마다 원하는 모양이 다르다. 안수경 선생님은 유형별 파일 · 정답 뒤에 붙임 ·
 * 공급처 표기 없음이다. 주문마다 다시 고르지 않게 회원 상세에 적어 두고 꺼내 쓴다.
 */
export interface VariantPrintFormat {
  /** 머리말 오른쪽 표기. 비우면 아무것도 안 찍는다(기본). */
  brand: string;
  /** 정답·해설을 문서 뒤에 붙일지 */
  includeAnswers: boolean;
  /** 유형별로 파일을 나눌지. 끄면 한 파일에 전부. */
  splitByType: boolean;
  /** 유형명 뒤에 "(고난도)" 를 붙일지 */
  hardSuffix: boolean;
}

export const DEFAULT_VARIANT_PRINT_FORMAT: VariantPrintFormat = {
  brand: '',
  includeAnswers: true,
  splitByType: true,
  hardSuffix: true,
};

/** 저장값이 비었거나 일부만 있어도 기본값으로 메워 돌려준다. */
export function normalizeVariantPrintFormat(raw: unknown): VariantPrintFormat {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    brand: typeof r.brand === 'string' ? r.brand.trim().slice(0, 60) : DEFAULT_VARIANT_PRINT_FORMAT.brand,
    includeAnswers: bool(r.includeAnswers, DEFAULT_VARIANT_PRINT_FORMAT.includeAnswers),
    splitByType: bool(r.splitByType, DEFAULT_VARIANT_PRINT_FORMAT.splitByType),
    hardSuffix: bool(r.hardSuffix, DEFAULT_VARIANT_PRINT_FORMAT.hardSuffix),
  };
}

/** "순서-고난도" → "글의 순서 (고난도)" */
export function variantTypePrintName(type: string, hardSuffix = true): string {
  const t = type.trim();
  const hard = t.endsWith('-고난도');
  const base = hard ? t.slice(0, -'-고난도'.length) : t;
  const name = TYPE_PRINT_NAME[base] ?? base;
  return hard && hardSuffix ? `${name} (고난도)` : name;
}

export interface VariantPrintQuestion {
  /** 출처 라벨 — "09회 18번" 처럼 문항 위에 작게 붙는다 */
  source: string;
  /** 발문 */
  question: string;
  /** 본문 (지문·보기 블록). 줄바꿈은 그대로 살린다 */
  paragraph: string;
  /** 선택지 — 이미 ①~⑤ 로 갈라 놓은 배열 */
  options: string[];
  /** 정답·해설 (정답지에만 쓰인다) */
  correctAnswer?: string;
  explanation?: string;
}

export interface VariantPrintInput {
  /** 큰 제목 — 예) "수능만만 10회 · 글의 순서" */
  title: string;
  /** 작은 제목 — 예) "수능만만 영어독해 20회 · 10회 · 총 21문항" */
  subtitle: string;
  /**
   * 오른쪽 끝 표기. 비우면 아무것도 찍지 않는다.
   *
   * 예전 자료에는 「고미조슈아」가 박혀 있었다. 선생님이 학생에게 그대로 나눠 주는
   * 자료라 공급처 이름이 남지 않는 편이 낫고(2026-08-29 지시), 필요하면 학원 이름을
   * 넣을 수 있게 값만 받아 둔다.
   */
  brand?: string;
  questions: VariantPrintQuestion[];
  /** 정답·해설을 뒤에 붙일지 */
  includeAnswers?: boolean;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 본문의 줄바꿈을 문단으로. 빈 줄은 문단 경계로 본다. */
function paragraphHtml(text: string): string {
  return String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${esc(line)}</p>`)
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

/* 문항은 페이지 중간에서 끊기지 않게 한다 — 지문 절반만 넘어가면 못 푼다 */
.q{margin:0 0 18px; padding-bottom:14px; border-bottom:1px solid #eee; break-inside:avoid; page-break-inside:avoid}
.q:last-child{border-bottom:0}
.q .no{display:inline-block; min-width:18px; padding:1px 5px; margin-right:7px;
  background:#333; color:#fff; font-size:8.5pt; font-weight:700; text-align:center; border-radius:2px}
.q .src{font-size:8.5pt; color:#666}
.q .prompt{margin:6px 0 8px; font-weight:700}
.q .passage{border:1px solid #ddd; border-radius:4px; padding:11px 13px; background:#fff}
.q .passage p{margin:0 0 7px; text-align:justify}
.q .passage p:last-child{margin-bottom:0}
.q .opts{margin:9px 0 0; padding:0; list-style:none}
.q .opts li{margin:2px 0}

/* 정답면은 문제면과 다른 장에서 시작한다 — 학생에게 문제만 먼저 주기 쉽다. */
.ans-head{margin:0 0 12px; padding-bottom:6px; border-bottom:2px solid #111; font-size:13pt; font-weight:800}
.ans-wrap{break-before:page; page-break-before:always}
.ans{margin:0 0 9px; padding:9px 11px; border:1px solid #e2e2e2; border-radius:4px;
  break-inside:avoid; page-break-inside:avoid}
.ans .k{font-weight:700}
.ans .k .a{color:#d32f2f}
.ans .e{margin-top:4px; color:#333; text-align:justify}
@page{size:A4; margin:0}
`;

export function buildVariantPrintHtml(input: VariantPrintInput): string {
  const qs = input.questions ?? [];
  const brand = (input.brand ?? '').trim();

  const body = qs
    .map((q, i) => {
      const opts = (q.options ?? []).filter((o) => String(o).trim() !== '');
      return `<div class="q">
  <div><span class="no">${i + 1}</span><span class="src">${esc(q.source)}</span></div>
  <div class="prompt">${esc(q.question)}</div>
  <div class="passage">${paragraphHtml(q.paragraph)}</div>
  ${opts.length > 0 ? `<ul class="opts">${opts.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
</div>`;
    })
    .join('\n');

  const answers = input.includeAnswers
    ? `<div class="ans-wrap">
<div class="ans-head">정답 및 해설</div>
${qs
  .map(
    (q, i) => `<div class="ans">
  <div class="k">${i + 1}. ${esc(q.source)}&nbsp;&nbsp;정답 <span class="a">${esc(q.correctAnswer ?? '')}</span></div>
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
