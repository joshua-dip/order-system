/**
 * 판매용 지문 분석지 조판 — passageState 하나를 A4 HTML 로 그린다.
 *
 * ⭐ next-quiz-feedback(리체움) lib/analysis-sheet-html.ts 의 이식본.
 *    2026-07-29 수능특강 Test1~3 분석지(문제편·해설편)가 이 조판으로 나갔고,
 *    같은 모양을 next-order 의 「지문 분석지」 메뉴에서도 내기 위해 가져왔다.
 *    조판 수정은 가능하면 두 리포에 같이 반영할 것.
 *
 *    원본과 다른 곳 — 데이터 관례 차이 흡수 (아래 셋뿐, 조판은 동일):
 *      · 단어 키       리체움 "si-wi" ↔ next-order "si:wi" → 로더에서 변환해 넘긴다
 *      · 종합분석      리체움 analysisResults.{koreanTopic…} ↔ 이쪽 analysisResults
 *                      .comprehensive['1'~'5'](주제·요지·요약·해석·함의) → compOf() 로 양쪽 수용
 *      · 어법 카운트   리체움 tagName 이 "#어법"/"#어휘" 리터럴 ↔ 이쪽은 서술형 tagName
 *                      + category 필드 → isVocabTag() 로 양쪽 수용
 *
 * 화면 내보내기(PdfExportContent)는 옵션이 100가지 넘는 편집 도구다. 여기서는 그걸 옮기지 않고
 * '팔 수 있는 한 권'에 필요한 것만 고정 조판으로 짠다 — 표지·목차·범례 페이지·판권·문제편/해설편.
 *
 * 두 판의 구분 (2026-07-29 실물 검수 + 참고 분석지 14종 대조 후 확정)
 *   문제편  깨끗한 지문 + 어법 밑줄 과제 + 쓰기 연습(주제·요약 괘선, 단어 체크박스).
 *           해석은 지문 끝 모음(기본) — 문장 밑에 바로 있으면 해석 연습이 스포일된다.
 *   해설편  전부: 형광펜·괄호+라벨·끊어읽기·SVOC·글로스·어법 콜아웃·종합분석·변형문제 예상.
 *
 * 표기 규약(분석기와 동일)
 *   syntaxPhrases  type 'clause' → [ ]  ·  'phrase' → ( )   + 위첨자 라벨
 *   sentenceBreaks word[i] **뒤** 간격에 /  (앱·PDF 와 같은 규약)
 *   svocData       S · V · Od · Oi · Cs · Co 를 단어 위에
 *   색 = 출제 유형: 노랑=주제문(주제·빈칸) · 연두=핵심 어휘(어휘) · 분홍=연결어(순서·삽입) ·
 *                  빨강 밑줄=어법(어법·서술형)
 */

export interface SheetPassage {
  교재명?: string; 강?: string; 번호?: string; 페이지?: string;
  state: Record<string, any>;
}

/** 분석지에 무엇을 실을지 — 이 묶음이 곧 '양식'이다(저장·불러오기 대상). */
export interface SheetOptions {
  koPlacement: 'inline' | 'bottom' | 'none';   // 해석 위치
  gloss: boolean;             // 단어 아래 뜻(직독직해)
  svoc: boolean;              // S·V·Od·Cs 성분 표기
  brackets: boolean;          // 구문 괄호 [ ] ( )
  bracketLabels: boolean;     // 괄호 라벨(전치사구…)
  breaks: boolean;            // 끊어읽기 /
  topicHighlight: boolean;    // 주제문 노랑 + 배지
  contextHighlight: boolean;  // 핵심 어휘 연두
  connHighlight: boolean;     // 연결어 분홍
  grammarUnderline: boolean;  // 어법 빨강 밑줄
  grammarCallout: boolean;    // 문장 아래 어법 설명 상자
  topicLine: boolean;         // 지문 머리 ◎ 한 줄 요약
  headerPills: boolean;       // 헤더 배지(글의 목적·어법 N포인트)
  practiceLines: boolean;     // 주제·요약 쓰기 괘선
  summaryTable: boolean;      // 종합분석 표
  examChips: boolean;         // 변형문제 예상 칩
  tagSummary: boolean;        // 어법 유형 집계
  vocab: boolean;             // 단어장(2단)
  vocabSynAnt: boolean;       // 단어장 동의어·반의어
  vocabCheckbox: boolean;     // 단어장 체크박스
  cover: boolean; toc: boolean; guide: boolean; colophon: boolean;
}

/** 기본 양식 = 전체 표기 분석지(단일 판매본) */
export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  koPlacement: 'inline',
  gloss: true, svoc: true, brackets: true, bracketLabels: true, breaks: true,
  topicHighlight: true, contextHighlight: true, connHighlight: true,
  grammarUnderline: true, grammarCallout: true,
  topicLine: true, headerPills: true, practiceLines: false,
  summaryTable: true, examChips: true, tagSummary: true,
  vocab: true, vocabSynAnt: true, vocabCheckbox: false,
  cover: true, toc: true, guide: true, colophon: true,
};

/**
 * 문제편 양식 — 2026-07-29 실물(수능특강 Test1~3 문제편)에서 확정.
 * 깨끗한 지문 + 어법 빨간 밑줄 과제만 남기고, 해석은 지문 끝 모음,
 * 쓰기 괘선(주제·한 줄 요약) + 체크박스 단어장. 안내 페이지·종합분석·칩은 해설편 전용.
 */
export const QUESTION_EDITION_OPTIONS: Partial<SheetOptions> = {
  koPlacement: 'bottom',
  gloss: false, svoc: false, brackets: false, bracketLabels: false, breaks: false,
  topicHighlight: false, contextHighlight: false, connHighlight: false,
  grammarUnderline: true, grammarCallout: false,
  topicLine: false, headerPills: true, practiceLines: true,
  summaryTable: false, examChips: false, tagSummary: false,
  vocab: true, vocabSynAnt: false, vocabCheckbox: true,
  cover: true, toc: true, guide: false, colophon: true,
};

/**
 * 종합분석 접근자 — 두 저장 관례를 하나의 모양으로.
 *   리체움:  analysisResults.koreanTopic / originalSentence / englishSummary / koreanTranslation / implicitMeaning
 *   이쪽:    analysisResults.comprehensive['1'~'5'] = 주제·요지·요약·해석·함의 (전부 한글 산문)
 * koreanTopic(한 줄 요약·목차용)은 양쪽 다 "이 글의 주제 한 줄"이라 의미가 같다.
 */
function compOf(st: Record<string, any>): { koreanTopic: string; implicitMeaning: string; named: boolean; rows: [string, unknown][] } {
  const raw = st.analysisResults ?? {};
  const comp = (raw.comprehensive && typeof raw.comprehensive === 'object') ? raw.comprehensive : raw;
  const named = !!(typeof comp.koreanTopic === 'string' && comp.koreanTopic.trim());
  const rows: [string, unknown][] = named
    ? [['주제', comp.koreanTopic], ['주제문', comp.originalSentence], ['영문 요약', comp.englishSummary],
       ['한글 요약', comp.koreanTranslation], ['출제 포인트', comp.implicitMeaning]]
    : [['주제', comp['1']], ['요지', comp['2']], ['요약', comp['3']], ['해석', comp['4']], ['함의', comp['5']]];
  return {
    koreanTopic: String(comp.koreanTopic ?? comp['1'] ?? '').trim(),
    implicitMeaning: String(comp.implicitMeaning ?? comp['5'] ?? '').trim(),
    named,
    rows,
  };
}

/** 어휘 성격의 태그인가 — 리체움은 tagName "#어휘", 이쪽은 category '어휘'. */
const isVocabTag = (t: Record<string, any>) =>
  String(t?.category ?? '').includes('어휘') || String(t?.tagName ?? '').includes('어휘');

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SVOC_COLOR: Record<string, string> = {
  S: '#b45309', V: '#1d4ed8', Oi: '#047857', Od: '#15803d', Cs: '#7e22ce', Co: '#be185d',
};

const circ = (n: number) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);

/** 담화 표지(연결어) 사전 — 문두에서만 감지한다. 색이 곧 '순서·삽입 출제 예고'가 된다. */
const CONN_PHRASES: string[][] = [
  ['on', 'the', 'other', 'hand'],
  ['as', 'a', 'result'], ['in', 'other', 'words'],
  ['for', 'example'], ['for', 'instance'], ['in', 'fact'], ['in', 'contrast'],
  ['in', 'addition'], ['in', 'short'], ['in', 'conclusion'], ['by', 'contrast'],
  ['after', 'all'], ['above', 'all'], ['in', 'turn'],
];
const CONN_WORDS = new Set([
  'however', 'therefore', 'thus', 'also', 'moreover', 'furthermore', 'instead',
  'nevertheless', 'nonetheless', 'meanwhile', 'similarly', 'likewise', 'consequently',
  'finally', 'first', 'second', 'third', 'next', 'then', 'rather', 'indeed',
  'otherwise', 'still', 'yet', 'but', 'so', 'accordingly', 'overall', 'ultimately', 'conversely',
]);
const lw = (s: string) => s.toLowerCase().replace(/[.,;:!?()[\]{}"'`]/g, '');

/** 문두 연결어가 차지하는 단어 수(0 이면 없음) */
function connectiveLen(words: string[]): number {
  for (const ph of CONN_PHRASES) {
    if (ph.length <= words.length && ph.every((w, i) => lw(words[i]) === w)) return ph.length;
  }
  return CONN_WORDS.has(lw(words[0] ?? '')) ? 1 : 0;
}

/** 한 문장을 표기 붙여 그린다 */
function renderSentence(si: number, sentence: string, st: Record<string, any>, o: SheetOptions, gloss?: Map<string, string>) {
  const words = String(sentence).split(/\s+/);
  const breaks: number[] = o.breaks ? (st.sentenceBreaks?.[si] ?? []) : [];
  const phrases: any[] = o.brackets
    ? (st.syntaxPhrases?.[si] ?? []).slice()
        .sort((a: any, b: any) => (a.startIndex - b.startIndex) || ((b.endIndex - b.startIndex) - (a.endIndex - a.startIndex)))
    : [];
  const svoc = o.svoc ? st.svocData?.[si] : null;
  const gWords = new Set<string>(o.grammarUnderline ? (st.grammarSelectedWords ?? []) : []);
  const cWords = new Set<string>(o.contextHighlight ? (st.contextSelectedWords ?? []) : []);
  const gRanges: any[] = o.grammarUnderline
    ? (st.grammarSelectedRanges ?? []).filter((r: any) => r.sentenceIndex === si) : [];
  const connLen = o.connHighlight ? connectiveLen(words) : 0;

  const svocTag = (wi: number): { tag: string; start: boolean } | null => {
    if (!svoc) return null;
    const hit = (s: string, e: string, tag: string) => {
      const a = svoc[s], b = svoc[e];
      if (a == null || a < 0 || wi < a || wi > (b ?? a)) return null;
      return { tag, start: wi === a };
    };
    return hit('subjectStart', 'subjectEnd', 'S')
      ?? hit('verbStart', 'verbEnd', 'V')
      ?? hit('indirectObjectStart', 'indirectObjectEnd', 'Oi')
      ?? hit('directObjectStart', 'directObjectEnd', 'Od')
      ?? hit('objectStart', 'objectEnd', 'Od')
      ?? hit('subjectComplementStart', 'subjectComplementEnd', 'Cs')
      ?? hit('complementStart', 'complementEnd', 'Cs')
      ?? hit('objectComplementStart', 'objectComplementEnd', 'Co');
  };

  const inRange = (wi: number) => gRanges.some((r) => wi >= r.startWordIndex && wi <= r.endWordIndex);

  let out = '';
  for (let wi = 0; wi < words.length; wi += 1) {
    for (const p of phrases) {
      if (p.startIndex === wi) {
        out += `<span class="br" style="color:${esc(p.color || '#455a64')}">${p.type === 'clause' ? '[' : '('}</span>`;
      }
    }

    const tag = svocTag(wi);
    const cls = [
      gWords.has(`${si}-${wi}`) || inRange(wi) ? 'g' : '',
      cWords.has(`${si}-${wi}`) ? 'c' : '',
      wi < connLen ? 'conn' : '',
    ].filter(Boolean).join(' ');
    const tagHtml = tag?.start
      ? `<span class="svoc" style="color:${SVOC_COLOR[tag.tag]}">${tag.tag}</span>`
      : '';
    // 직독직해 글로스 — 핵심 어휘의 뜻을 단어 바로 아래에(Supreme 분석지 방식, 해설편만)
    const g = gloss?.get(`${si}-${wi}`);
    const glossHtml = g ? `<span class="gl">${esc(g)}</span>` : '';
    out += `<span class="w${cls ? ' ' + cls : ''}">${tagHtml}${esc(words[wi])}${glossHtml}</span>`;

    for (const p of phrases) {
      if (p.endIndex === wi) {
        out += `<span class="br" style="color:${esc(p.color || '#455a64')}">${p.type === 'clause' ? ']' : ')'}</span>`;
        if (o.bracketLabels && p.label) out += `<sup class="lab" style="color:${esc(p.color || '#455a64')}">${esc(p.label)}</sup>`;
      }
    }
    // 끊어읽기 슬래시는 word[i] 뒤 간격에(앱·PDF 규약)
    if (breaks.includes(wi) && wi < words.length - 1) out += ` <span class="brk">/</span>`;
    out += ' ';
  }
  return out;
}

/** 단어장 — 두 단으로 나눠 지면 낭비를 줄인다. */
function vocabTables(vocab: any[], o: SheetOptions) {
  if (!vocab.length || !o.vocab) return '';
  const half = Math.ceil(vocab.length / 2);
  const cols = [vocab.slice(0, half), vocab.slice(half)].filter((c) => c.length);
  const row = (v: any) => `<tr>${o.vocabCheckbox ? '<td class="ckb"><span class="ck"></span></td>' : ''}
    <td class="vw">${esc(v.word)}</td><td class="vp">${esc(v.partOfSpeech)}</td>
    <td>${esc(v.meaning)}${v.synonym ? ` <span class="ex">${esc(v.synonym)}</span>` : ''}${
      o.vocabSynAnt && (v.antonym || v.opposite)
        ? `<div class="syn">${v.antonym ? `= ${esc(v.antonym)}` : ''}${v.antonym && v.opposite ? ' · ' : ''}${v.opposite ? `↔ ${esc(v.opposite)}` : ''}</div>`
        : ''}</td></tr>`;
  const table = (list: any[]) => `<table class="vc">
    <thead><tr>${o.vocabCheckbox ? '<th class="ckb">✓</th>' : ''}<th>단어</th><th>품사</th><th>뜻${o.vocabSynAnt ? ' · = 동의어 ↔ 반의어' : ''}</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody></table>`;
  return `<div class="hgroup"><h3>어휘 (${vocab.length})</h3></div><div class="vwrap">${cols.map(table).join('')}</div>`;
}

/** 변형문제 예상 칩 — 기존 분석 데이터에서 휴리스틱으로 고확률 유형을 켠다 */
function examTypeChips(st: Record<string, any>, connCount: number) {
  const tags: any[] = st.grammarTags ?? [];
  const topic = (st.topicHighlightedSentences ?? []).length > 0;
  const on: Record<string, boolean> = {
    '주제·제목·요지': topic,
    '빈칸': topic,
    '어법': tags.some((t) => !isVocabTag(t)),
    '어휘': tags.some(isVocabTag) || (st.contextSelectedWords ?? []).length > 0,
    '순서·삽입': connCount >= 2,
    '서술형': (st.essayHighlightedSentences ?? []).length > 0,
    '내용일치': true,
    '함축': compOf(st).implicitMeaning.includes('함축'),
  };
  return `<div class="chips"><span class="chipt">변형문제 예상</span>${
    Object.entries(on).map(([k, v]) => `<span class="chip${v ? ' on' : ''}">${v ? '■' : '□'} ${k}</span>`).join('')
  }</div>`;
}

function passagePages(p: SheetPassage, no: number, o: SheetOptions) {
  const st = p.state ?? {};
  const sents: string[] = st.sentences ?? [];
  const kors: string[] = st.koreanSentences ?? [];
  const topic = new Set<number>(o.topicHighlight ? (st.topicHighlightedSentences ?? []) : []);
  const essay = new Set<number>(o.topicHighlight ? (st.essayHighlightedSentences ?? []) : []);
  const ar = compOf(st);
  const tags: any[] = st.grammarTags ?? [];
  const vocab: any[] = st.vocabularyList ?? [];
  const connCount = sents.reduce((n, s) => n + (connectiveLen(String(s).split(/\s+/)) ? 1 : 0), 0);

  // 핵심 어휘 글로스 맵 — "문장-단어" 위치에 뜻을 단다(해설편만)
  const gloss = new Map<string, string>();
  if (o.gloss) {
    for (const v of vocab) {
      // 첫 뜻만, 괄호 보충은 떼고 — "(팔을) 끼다, 접다" → "끼다".
      // 긴 글로스는 단어 칸을 벌려 문장 사이에 어색한 공백을 만든다.
      const m = String(v.meaning ?? '').replace(/\([^)]*\)/g, '').split(/[,·]/)[0].trim();
      if (!m) continue;
      for (const pos of v.positions ?? []) gloss.set(`${pos.sentence}-${pos.position}`, m);
    }
  }

  // 헤더 배지 — 답이 아니라 '무엇을 연습할 지문인지'만 알려주므로 문제편에도 싣는다
  const pills: string[] = [];
  /* 원본과 다른 곳: 함의 배지는 명명 키(리체움) 데이터에만. 리체움은 implicitMeaning 이
     "글의 목적 — …" 라벨로 시작하지만 이쪽 번호 키의 함의('5')는 산문이라, 우연히 짧은
     첫 조각("spirits는 '영혼")이 배지로 새어 들어간다 — 전권 검수에서 4건 실측. */
  if (o.headerPills) { const im = ar.named ? ar.implicitMeaning.split(/[—:·]/)[0].trim() : '';
  if (im && im.length <= 12) pills.push(`<span class="pill">${esc(im)}</span>`);
  const gCount = tags.filter((t) => !isVocabTag(t)).length;
  if (gCount) pills.push(`<span class="pill">어법 ${gCount}포인트</span>`); }

  const head = `<div class="ph"><span class="no">${no}</span>
    <span class="src">${esc(p.교재명 ?? '')} ${esc(p.강 ?? '')} ${esc(p.번호 ?? '')}</span>
    ${pills.join('')}
    ${p.페이지 ? `<span class="pg">${esc(p.페이지)}</span>` : ''}</div>`;

  // 지문 머리 한 줄 요약(아잉카 방식) — 훑어볼 때 주제가 바로 잡히게(해설편만)
  const tline = o.topicLine && ar.koreanTopic
    ? `<div class="tline">◎ ${esc(ar.koreanTopic)}</div>` : '';

  const roleBadge = (si: number) => {
    if (!o.topicHighlight) return '';
    if (topic.has(si)) return '<span class="badge b-t">주제문</span>';
    if (essay.has(si)) return '<span class="badge b-e">서술형</span>';
    return '';
  };

  // 어법 콜아웃 — 설명을 그 문장 바로 아래에(상세분석형 참고자료의 최대 강점)
  const tagsBySent = new Map<number, any[]>();
  if (o.grammarCallout) for (const t of tags) {
    if (!tagsBySent.has(t.sentenceIndex)) tagsBySent.set(t.sentenceIndex, []);
    tagsBySent.get(t.sentenceIndex)!.push(t);
  }
  const callout = (si: number) => {
    const list = tagsBySent.get(si);
    if (!list?.length) return '';
    return `<div class="gp">${list.map((t) =>
      `<div><b>${esc(t.tagName)}</b> <i>${esc(t.selectedText)}</i> — ${esc(t.explanation)}</div>`).join('')}</div>`;
  };

  const sentBlock = (s: string, si: number) => `
    <div class="sent${topic.has(si) ? ' topic' : essay.has(si) ? ' essay' : ''}">
      <span class="si">${si + 1}</span>${roleBadge(si)}
      <span class="en">${renderSentence(si, s, st, o, gloss)}</span>
      ${o.koPlacement === 'inline' && kors[si] ? `<div class="ko">${esc(kors[si])}</div>` : ''}
    </div>${callout(si)}`;
  const body = sents.map(sentBlock).join('');

  // 해석 모음(문제편 기본) — 문장 밑에 바로 있으면 해석 연습이 스포일된다
  const koBlock = o.koPlacement === 'bottom' && kors.length
    ? `<div class="kos"><div class="kosh">해석</div>${kors.map((k, i) =>
        `<span class="kon">${i + 1}</span> ${esc(k)} `).join('')}</div>` : '';

  // 문제편 쓰기 연습 — 해설편 종합분석표와 1:1 로 대조하는 동선
  const practice = o.practiceLines ? `<div class="wr">
      <div class="wrl"><span>주제문에 밑줄을 긋고, 주제를 써 보세요</span><span class="line"></span></div>
      <div class="wrl"><span>한 줄 요약</span><span class="line"></span></div>
    </div>` : '';

  const box = (label: string, v: unknown) => (String(v ?? '').trim()
    ? `<tr><th>${esc(label)}</th><td>${esc(v)}</td></tr>` : '');
  const summary = `<table class="sum">
    ${ar.rows.map(([label, v]) => box(label, v)).join('')}
  </table>`;

  // 어법 유형 집계 — 설명은 콜아웃에 있으므로 여기는 '지문의 문법 지형' 한눈보기
  const tagSummary = (() => {
    if (!tags.length || !o.tagSummary) return '';
    const byName = new Map<string, number[]>();
    for (const t of tags) {
      if (!byName.has(t.tagName)) byName.set(t.tagName, []);
      byName.get(t.tagName)!.push(t.sentenceIndex + 1);
    }
    return `<div class="tgsum">${[...byName.entries()].map(([name, sis]) =>
      `<span class="tgs"><b>${esc(name)}</b> ${[...new Set(sis)].sort((a, b) => a - b).map(circ).join(' ')}</span>`).join(' · ')}</div>`;
  })();

  return `<section class="pg-break">${head}${tline}${body}${koBlock}${practice}
    ${o.summaryTable ? summary : ''}${o.examChips ? examTypeChips(st, connCount) : ''}${tagSummary}${vocabTables(vocab, o)}</section>`;
}

/** 권두 '이렇게 읽어주세요' — 표기 규칙을 실제 예시로 시연(해설편) */
function guidePage() {
  return `<section class="pg-break guide">
    <h2>이렇게 읽어주세요</h2>
    <div class="grow"><div class="gsym"><span style="background:#fff7cc;padding:1px 4px">노란 문장</span></div>
      <div>주제문입니다. <b>주제·제목·요지·빈칸</b> 문제로 출제되는 문장이에요.</div></div>
    <div class="grow"><div class="gsym"><span style="background:#d9f2e0;border-radius:2px;padding:1px 4px">연두 단어</span></div>
      <div>문맥상 핵심 어휘 — <b>어휘</b> 문제의 후보입니다. 뜻이 단어 아래 파란 글씨로 붙어 있어요.</div></div>
    <div class="grow"><div class="gsym"><span style="background:#fce7f3;border-radius:2px;padding:1px 4px">분홍 단어</span></div>
      <div>연결어(However·Therefore·For example…) — 글의 흐름이 꺾이는 곳. <b>순서·삽입</b> 문제의 힌트입니다.</div></div>
    <div class="grow"><div class="gsym"><span style="border-bottom:1.6px solid #dc2626;padding:0 2px">빨간 밑줄</span></div>
      <div>어법 포인트 — 문장 아래 주황 상자에 왜 그 형태인지 설명이 붙습니다. <b>어법·서술형</b> 대비.</div></div>
    <div class="grow"><div class="gsym"><b>[ ]</b> 절 · <b>( )</b> 구</div>
      <div>괄호 끝 작은 라벨(<span style="color:#6a1b9a">전치사구</span>·<span style="color:#1565c0">명사절</span>…)이 그 덩어리의 정체입니다.</div></div>
    <div class="grow"><div class="gsym"><span style="color:#2563eb;font-weight:800">/</span> 끊어읽기</div>
      <div>의미 단위 경계 — 슬래시 단위로 읽고 해석해 보세요.</div></div>
    <div class="grow"><div class="gsym"><span style="color:#b45309;font-weight:800">S</span>
      <span style="color:#1d4ed8;font-weight:800">V</span> <span style="color:#15803d;font-weight:800">Od</span>
      <span style="color:#7e22ce;font-weight:800">Cs</span></div>
      <div>단어 위 작은 표기 = 주어·동사·목적어·보어. 문장 뼈대를 먼저 잡는 습관을 들이세요.</div></div>
    <div class="grow"><div class="gsym">■ 변형문제 예상</div>
      <div>지문마다 종합분석 아래에, 내신·변형으로 출제될 확률이 높은 유형을 ■ 로 표시했습니다.</div></div>
  </section>`;
}

const CSS = `
/* 다크 모드 브라우저에서 미리보기 글자가 안 보이던 것 — 지면은 항상 흰 종이다 */
:root{color-scheme:light}
*{box-sizing:border-box} html,body{background:#fff}
body{margin:0;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#111;font-size:10.5pt}
.pg-break{page-break-after:always;padding:0 2mm}
.ph{display:flex;align-items:baseline;gap:8px;border-bottom:2px solid #1f2937;padding-bottom:4px;margin-bottom:10px}
.ph .no{font-weight:800;font-size:15pt;color:#1f2937}
.ph .src{font-size:9pt;color:#4b5563;flex:1}
.ph .pg{font-size:8.5pt;color:#9ca3af}
.pill{font-size:7.4pt;font-weight:700;color:#334155;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:1px 7px;white-space:nowrap}
/* 원본과 다른 곳: SVOC 마커(top:-11px)가 블록 상자 밖에 떠 있어, 문장 블록이
   페이지 끝에 걸리면 마커 줄만 이전 페이지에 유령처럼 남았다(9월 고3 26번 실측).
   첫 줄 위 11px 를 블록 안 여백으로 확보해 마커가 상자 안에 들어오게 한다 —
   break-inside:avoid 가 이제 마커까지 통째로 지킨다. */
.sent{margin:0 0 6px;padding:12px 4px 3px;border-radius:3px;line-height:2.0;page-break-inside:avoid}
body.q .sent{line-height:1.8}
.sent.topic{background:#fff7cc}
.sent.essay{background:#fdf2f8}
.si{display:inline-block;min-width:15px;font-size:8pt;color:#9ca3af;font-weight:700;vertical-align:top}
.en{font-family:'Times New Roman',serif;font-size:11pt}
.w{position:relative;display:inline-block;vertical-align:top;text-align:center}
.br,.brk,.lab{vertical-align:top}
.gl{display:block;font-size:6.4pt;color:#0e7490;font-weight:400;line-height:1.15;margin-top:1.5px;white-space:nowrap;font-family:'Noto Sans KR','Malgun Gothic',sans-serif}
.badge{display:inline-block;font-size:6.8pt;font-weight:800;border-radius:3px;padding:1px 4px;margin-right:4px;vertical-align:2px}
.b-t{background:#fde047;color:#713f12}
.b-e{background:#bfdbfe;color:#1e3a8a}
.tline{font-size:8.8pt;color:#334155;background:#f8fafc;border-left:3px solid #94a3b8;padding:3px 7px;margin:-4px 0 9px}
.w.g{border-bottom:1.6px solid #dc2626}
.w.c{background:#d9f2e0;border-radius:2px}
.w.conn{background:#fce7f3;border-radius:2px}
.svoc{position:absolute;top:-11px;left:0;font-size:6.5pt;font-weight:800;letter-spacing:-.2px}
.br{font-weight:800}
.brk{color:#2563eb;font-weight:800}
.lab{font-size:6pt;margin-left:1px}
.ko{font-size:9pt;color:#4b5563;margin:1px 0 0 15px;line-height:1.5}
.gp{font-size:8.2pt;color:#7c2d12;background:#fff7ed;border-left:3px solid #f97316;border-radius:0 3px 3px 0;padding:3px 7px;margin:-2px 0 7px 15px;line-height:1.55;page-break-inside:avoid}
.gp b{color:#c2410c} .gp i{font-family:'Times New Roman',serif;font-style:normal;color:#9a3412}
.kos{font-size:8.6pt;color:#4b5563;line-height:1.7;border-top:1px dashed #cbd5e1;margin-top:9px;padding-top:7px}
.kosh{font-weight:800;font-size:8.4pt;color:#334155;margin-bottom:3px}
.kon{display:inline-block;font-size:7pt;color:#94a3b8;font-weight:700;margin-left:2px}
.wr{margin:10px 0 2px;page-break-inside:avoid}
.wrl{display:flex;gap:8px;align-items:flex-end;font-size:8.6pt;color:#475569;margin-bottom:12px}
.wrl span:first-child{white-space:nowrap;font-weight:700}
.wrl .line{flex:1;border-bottom:1px solid #94a3b8;height:1em}
.hgroup{page-break-after:avoid}
h3{font-size:10pt;margin:11px 0 4px;padding-left:5px;border-left:3px solid #1f2937;page-break-after:avoid}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
tr{page-break-inside:avoid}
.sum{page-break-inside:avoid}
.sum th{width:72px;white-space:nowrap;background:#f3f4f6;text-align:left;padding:4px 6px;border:1px solid #e5e7eb;font-weight:700;color:#374151}
.sum td{padding:4px 6px;border:1px solid #e5e7eb}
.chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:7px 0 2px;page-break-inside:avoid}
.chipt{font-size:8pt;font-weight:800;color:#1f2937;margin-right:2px}
.chip{font-size:7.6pt;color:#9ca3af;border:1px solid #e5e7eb;border-radius:8px;padding:1px 7px;white-space:nowrap}
.chip.on{color:#b91c1c;border-color:#fca5a5;background:#fef2f2;font-weight:700}
.tgsum{font-size:8pt;color:#57534e;margin:6px 0 0;page-break-inside:avoid}
.tgs b{color:#b45309}
.vwrap{display:flex;gap:4mm;align-items:flex-start}
.vwrap table{width:50%}
.vc th{background:#f3f4f6;padding:3px 5px;border:1px solid #e5e7eb;font-size:7.8pt;text-align:left}
.vc td{padding:2.5px 5px;border:1px solid #e5e7eb}
.vc .vw{font-family:'Times New Roman',serif;font-weight:700;width:80px}
.vc .vp{width:30px;color:#6b7280;font-size:8pt}
.vc .ckb{width:16px;text-align:center;color:#9ca3af}
.ck{display:inline-block;width:8px;height:8px;border:1px solid #94a3b8;border-radius:2px}
.vc .syn{color:#6b7280;font-size:7.6pt;margin-top:1px}
.ex{color:#9ca3af;font-size:8pt}
.cover{height:265mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.cover .kind{font-size:11pt;letter-spacing:6px;color:#6b7280}
.cover h1{font-size:27pt;margin:14px 0 6px;letter-spacing:-1px}
.cover .sub{font-size:13pt;color:#374151}
.cover .rule{width:70px;height:3px;background:#1f2937;margin:22px 0}
.cover .brand{position:absolute;bottom:24mm;font-size:9.5pt;color:#9ca3af;letter-spacing:2px}
.toc h2{font-size:15pt;border-bottom:2px solid #1f2937;padding-bottom:6px}
.toc ol{padding-left:0;list-style:none;columns:2;column-gap:12mm;font-size:9.5pt}
.toc li{padding:2.5px 0;border-bottom:1px dotted #e5e7eb;break-inside:avoid;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toc .n{display:inline-block;width:22px;font-weight:700;color:#6b7280}
.guide h2{font-size:15pt;border-bottom:2px solid #1f2937;padding-bottom:6px}
.grow{display:flex;gap:10px;align-items:baseline;padding:7px 2px;border-bottom:1px dotted #e5e7eb;font-size:9.5pt;line-height:1.7}
.gsym{min-width:150px;font-size:9.5pt}
.colo{font-size:8.5pt;color:#6b7280;line-height:1.9;padding-top:60mm}
.legend{font-size:7.6pt;color:#6b7280;border:1px solid #e5e7eb;background:#fafafa;border-radius:4px;padding:5px 8px;margin-bottom:9px;line-height:1.8}
`;

export function buildAnalysisSheetHtml(opts: {
  title: string;
  subtitle?: string;
  passages: SheetPassage[];
  brand?: string;
  date?: string;
  /** 양식 — 지정하지 않은 항목은 기본 양식을 따른다 */
  options?: Partial<SheetOptions>;
  /** 표지·판권에 찍히는 판 이름(예: '분석지', '해설편') */
  editionLabel?: string;
}) {
  const { title, subtitle = '', passages, brand = 'LYCEUM', date = '' } = opts;
  const o: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, ...(opts.options ?? {}) };
  const kind = opts.editionLabel ?? '분석지';

  const cover = !o.cover ? '' : `<section class="pg-break cover">
    <div class="kind">ANALYSIS · ${esc(kind)}</div>
    <h1>${esc(title)}</h1>
    <div class="rule"></div>
    ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
    <div class="sub" style="margin-top:8px;font-size:10.5pt;color:#6b7280">지문 ${passages.length}편${date ? ` · ${esc(date)}` : ''}</div>
    <div class="brand">${esc(brand)}</div>
  </section>`;

  const tocLine = (p: SheetPassage) => {
    const t = compOf(p.state ?? {}).koreanTopic;
    return t.length > 30 ? `${t.slice(0, 30)}…` : t;
  };
  /* 원본과 다른 곳: 강명이 길면(교과서 챕터 서술) 목차에서 생략 — 번호와 주제
     한 줄이 잘려 목차 구실을 못 한다. 강명은 지문 머리말에 그대로 남는다. */
  const tocChapter = (p: SheetPassage) => {
    const c = String(p.강 ?? '').trim();
    return c && c.length <= 20 ? `${c} ` : '';
  };
  const toc = !o.toc ? '' : `<section class="pg-break toc"><h2>목차</h2><ol>
    ${passages.map((p, i) => `<li><span class="n">${i + 1}</span>${esc(tocChapter(p))}${esc(p.번호 ?? '')}
      <span style="color:#9ca3af"> · ${esc(tocLine(p))}</span></li>`).join('')}
  </ol></section>`;

  const legend = o.svoc || o.brackets
    ? `<div class="legend"><b>보는 법</b> &nbsp; <span style="background:#fff7cc">주제문</span>(주제·빈칸) ·
        <span style="background:#d9f2e0">핵심 어휘</span>(어휘) ·
        <span style="background:#fce7f3">연결어</span>(순서·삽입) ·
        <span style="border-bottom:1.6px solid #dc2626">어법</span>(어법·서술형) ·
        <span style="color:#2563eb;font-weight:800">/</span> 끊어읽기 · <b>[ ]</b> 절 · <b>( )</b> 구 ·
        <span style="color:#b45309;font-weight:800">S</span>
        <span style="color:#1d4ed8;font-weight:800">V</span>
        <span style="color:#15803d;font-weight:800">Od</span>
        <span style="color:#7e22ce;font-weight:800">Cs</span> 성분</div>`
    : `<div class="legend"><b>공부하는 법</b> &nbsp;
        <span style="border-bottom:1.6px solid #dc2626">밑줄</span> = 어법 포인트 — 왜 이 형태인지 스스로 설명해 보세요.
        주제문 찾기 · 끊어읽기 · 구문 괄호는 직접 표시하고, 아래 쓰기 칸을 채운 뒤 해설편과 비교하세요.</div>`;

  const bodyPages = passages.map((p, i) =>
    (i === 0 ? legend : '') + passagePages(p, i + 1, o)).join('');

  const colophon = !o.colophon ? '' : `<section class="colo">
    <div style="border-top:2px solid #1f2937;padding-top:10px">
      <b style="font-size:11pt;color:#111">${esc(title)} · ${esc(kind)}</b><br>
      발행 ${esc(brand)}${date ? ` · ${esc(date)}` : ''}<br>
      본 자료는 학습 목적으로 제작되었습니다. 무단 복제·배포를 금합니다.
    </div></section>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head>
    <body class="${o.gloss || o.svoc ? 'a' : 'q'}">${cover}${toc}${o.guide ? guidePage() : ''}${bodyPages}${colophon}</body></html>`;
}
