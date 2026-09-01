/**
 * 분석지 인쇄 양식.
 *
 * 분석지 메뉴는 열려 있는데 정작 **뽑을 수단이 없었다.** 기존
 * `/admin/syntax-analyzer/pdf-export` 는 제목·본문을 손으로 붙여넣는 빈 상자라
 * `passage_analyses` 를 읽지도 않고, html2canvas 로 화면을 그림으로 떠서 A4 한 장만
 * 만든다(글자가 아니라 이미지라 검색·복사가 안 되고 여러 지문을 이을 수도 없다).
 *
 * 그래서 변형문제 인쇄와 같은 방식(서버 Chromium)으로 다시 만든다. 저장된 분석을
 * 그대로 읽어 지문 여러 개를 한 문서로 낸다.
 */

/** `passage_analyses.passageStates.main` 에서 인쇄에 쓰는 부분만 추린 모양 */
export interface AnalysisPrintPassage {
  /** 문서에 찍히는 지문 이름 — 예) "Lesson 2 본문1(p.48)" */
  label: string;
  sentences: string[];
  koreanSentences: string[];
  /** 종합분석 5슬롯 — { "1": 주제, "2": 요지, "3": 요약, "4": 해석, "5": 함의 } */
  comprehensive?: Record<string, string>;
  /** 주제문장·서술형대비 문장 인덱스 */
  topicSentences?: number[];
  essaySentences?: number[];
  /** 끊어읽기 — { 문장idx: [단어 위치…] } */
  sentenceBreaks?: Record<string, number[]>;
  /** 문장별 문법 포인트 */
  grammarPoints?: Record<string, { title: string; content: string }[]>;
  vocabulary?: {
    word: string;
    meaning: string;
    partOfSpeech?: string;
    cefr?: string;
    synonym?: string;
  }[];
}

export interface AnalysisPrintInput {
  title: string;
  subtitle: string;
  /** 머리말 오른쪽 표기. 비우면 안 찍는다(변형문제 인쇄와 같은 규칙). */
  brand?: string;
  passages: AnalysisPrintPassage[];
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 종합분석 키 → 이름.
 *
 * 저장 관례가 두 갈래다. CLI(cc:syntax)로 만든 분석은 번호 키('1'~'5')에
 * 주제·요지·요약·해석·함의를 한글로 담고(현재 84건 전부), 분석기 웹의 AI 경로는
 * 명명 키(koreanTopic…)에 ①한글 주제 ②원문 주제문장 ③영문 요약 ④한글 번역
 * ⑤함축적 표현을 담는다. 인쇄는 어느 쪽이 와도 제 이름을 붙인다 —
 * 번호 키에 웹 라벨을 붙이면 내용과 라벨이 어긋난다(2번이 실제로는 요지문).
 */
const COMPREHENSIVE_LABEL: Record<string, string> = {
  '1': '주제',
  '2': '요지',
  '3': '요약',
  '4': '해석',
  '5': '함의',
  koreanTopic: '한글 주제',
  originalSentence: '원문 주제문장',
  englishSummary: '영문 요약',
  koreanTranslation: '한글 번역',
  implicitMeaning: '함축적 표현',
};

const COMPREHENSIVE_ORDER = [
  '1', '2', '3', '4', '5',
  'koreanTopic', 'originalSentence', 'englishSummary', 'koreanTranslation', 'implicitMeaning',
];

/**
 * 끊어읽기 슬래시를 넣은 문장.
 *
 * `sentenceBreaks` 는 **단어 인덱스**라 공백으로 잘라 그 뒤에 `/` 를 끼운다.
 * 범위를 벗어난 값이 오면 조용히 건너뛴다 — 분석이 조금 어긋났다고 지면 전체가
 * 깨지면 안 된다.
 */
function withBreaks(sentence: string, breaks: number[] | undefined): string {
  const words = String(sentence ?? '').split(' ');
  if (!breaks || breaks.length === 0) return esc(sentence);
  const at = new Set(breaks.filter((n) => Number.isInteger(n) && n >= 0 && n < words.length));
  return words
    .map((w, i) => (at.has(i) ? `${esc(w)} <span class="sl">/</span>` : esc(w)))
    .join(' ');
}

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;
  color:#111; font-size:10pt; line-height:1.6;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.sheet{padding:15mm 13mm}
.head{border-bottom:2px solid #111; padding-bottom:6px; margin-bottom:14px}
.head .t{display:block; font-size:16pt; font-weight:800; letter-spacing:-0.3px}
.head .s{display:block; margin-top:4px; font-size:8.5pt; color:#666}
.head .brand{margin-left:6px; padding-left:8px; border-left:1px solid #d4d4d4}

/* 지문 하나가 한 장에서 시작하도록 — 여러 지문을 한 문서로 낼 때 섞이면 못 쓴다.
   장 나눔은 **앞에 다른 지문이 있을 때만** 준다. .psg:first-of-type 으로 첫 지문을
   빼려 했더니 :first-of-type 이 클래스가 아니라 요소 타입(div) 기준이라,
   머리말 div 때문에 첫 지문에도 장 나눔이 걸려 1쪽이 통째로 비었다. */
.psg + .psg{break-before:page; page-break-before:always}
.psg-name{font-size:12pt; font-weight:800; margin:0 0 10px; padding-bottom:4px; border-bottom:1px solid #333}

/* 섹션 통째로 break-inside:avoid 를 걸었더니, 13문장짜리 본문이 한 장을 다 써서
   앞 장이 절반 넘게 비었다. 끊기면 곤란한 최소 단위는 **표의 한 행**과 **문장 한 줄**
   이므로 그 둘만 막고 섹션은 자유롭게 넘기도록 둔다. */
.sec{margin:0 0 14px}
.sec > table tr{break-inside:avoid; page-break-inside:avoid}
.sec-t{display:inline-block; font-size:8.5pt; font-weight:800; color:#fff; background:#333;
  padding:2px 8px; border-radius:3px; margin-bottom:6px}

table.comp{width:100%; border-collapse:collapse}
table.comp th{width:52px; text-align:center; vertical-align:top; padding:5px 6px;
  background:#f4f4f5; border:1px solid #e4e4e7; font-size:8.5pt; font-weight:700}
table.comp td{padding:5px 8px; border:1px solid #e4e4e7; text-align:justify}

ol.sents{margin:0; padding-left:22px}
ol.sents li{margin:0 0 9px; break-inside:avoid; page-break-inside:avoid}
ol.sents .en{display:block}
ol.sents .ko{display:block; color:#555; font-size:9pt; margin-top:2px}
.sl{color:#c026d3; font-weight:700}
/* 주제문장·서술형대비는 배경으로 구분한다 — 인쇄물이라 색만으로는 약하다 */
li.topic{background:#fff7ed; border-left:3px solid #f59e0b; padding:3px 6px; margin-left:-9px}
li.essay{background:#eff6ff; border-left:3px solid #3b82f6; padding:3px 6px; margin-left:-9px}
.badge{font-size:7.5pt; font-weight:700; padding:0 5px; border-radius:8px; margin-left:5px; vertical-align:1px}
.badge.t{background:#f59e0b; color:#fff}
.badge.e{background:#3b82f6; color:#fff}

table.gp{width:100%; border-collapse:collapse; font-size:9pt}
table.gp th{width:110px; text-align:left; padding:4px 7px; background:#fafafa;
  border:1px solid #e4e4e7; font-weight:700}
table.gp td{padding:4px 7px; border:1px solid #e4e4e7}

table.voc{width:100%; border-collapse:collapse; font-size:9pt}
table.voc th{padding:4px 6px; background:#f4f4f5; border:1px solid #e4e4e7; font-weight:700; text-align:left}
table.voc td{padding:4px 6px; border:1px solid #e4e4e7; vertical-align:top}
table.voc .w{font-weight:700; white-space:nowrap}
table.voc .c{text-align:center; white-space:nowrap; color:#666}
@page{size:A4; margin:0}
`;

function passageHtml(p: AnalysisPrintPassage): string {
  const topic = new Set(p.topicSentences ?? []);
  const essay = new Set(p.essaySentences ?? []);

  const comp = p.comprehensive ?? {};
  /* 알려진 키를 정한 순서대로, 나머지(추가 슬롯 item_6…)는 뒤에 이름순으로. */
  const compRows = Object.keys(comp)
    .filter((k) => k !== 'error')
    .sort((a, b) => {
      const ia = COMPREHENSIVE_ORDER.indexOf(a);
      const ib = COMPREHENSIVE_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    })
    .filter((k) => String(comp[k] ?? '').trim() !== '')
    .map(
      (k) =>
        `<tr><th>${esc(COMPREHENSIVE_LABEL[k] ?? k.replace(/^item_(\d+)$/, '항목 $1'))}</th><td>${esc(comp[k])}</td></tr>`,
    )
    .join('');

  const sents = (p.sentences ?? [])
    .map((en, i) => {
      const cls = topic.has(i) ? 'topic' : essay.has(i) ? 'essay' : '';
      const badge = topic.has(i)
        ? '<span class="badge t">주제</span>'
        : essay.has(i)
          ? '<span class="badge e">서술형</span>'
          : '';
      const ko = p.koreanSentences?.[i] ?? '';
      return `<li class="${cls}">
  <span class="en">${withBreaks(en, p.sentenceBreaks?.[String(i)])}${badge}</span>
  ${ko ? `<span class="ko">${esc(ko)}</span>` : ''}
</li>`;
    })
    .join('\n');

  const gp = Object.entries(p.grammarPoints ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap(([idx, items]) =>
      (items ?? []).map(
        (it) =>
          `<tr><th>${Number(idx) + 1}번 · ${esc(it.title)}</th><td>${esc(it.content)}</td></tr>`,
      ),
    )
    .join('');

  const voc = (p.vocabulary ?? [])
    .map(
      (v) => `<tr>
  <td class="w">${esc(v.word)}</td>
  <td class="c">${esc(v.partOfSpeech ?? '')}</td>
  <td class="c">${esc(v.cefr ?? '')}</td>
  <td>${esc(v.meaning)}${v.synonym ? ` <span style="color:#888">≒ ${esc(v.synonym)}</span>` : ''}</td>
</tr>`,
    )
    .join('');

  return `<div class="psg">
  <div class="psg-name">${esc(p.label)}</div>
  ${compRows ? `<div class="sec"><span class="sec-t">종합분석</span><table class="comp">${compRows}</table></div>` : ''}
  <div class="sec"><span class="sec-t">본문 · 끊어읽기</span><ol class="sents">${sents}</ol></div>
  ${gp ? `<div class="sec"><span class="sec-t">문법 포인트</span><table class="gp">${gp}</table></div>` : ''}
  ${
    voc
      ? `<div class="sec"><span class="sec-t">어휘</span><table class="voc">
    <tr><th>단어</th><th style="width:44px">품사</th><th style="width:44px">CEFR</th><th>뜻</th></tr>${voc}</table></div>`
      : ''
  }
</div>`;
}

export function buildAnalysisPrintHtml(input: AnalysisPrintInput): string {
  const brand = (input.brand ?? '').trim();
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
  ${(input.passages ?? []).map(passageHtml).join('\n')}
</div></body></html>`;
}
