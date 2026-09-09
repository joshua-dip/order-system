/**
 * 분석지 조판 회귀 점검 — DB 없이 합성 지문으로 `buildAnalysisSheetHtml` 을 돌려
 * 실제로 틀렸던 표기(인수인계 2026-09-09 P0·P1)를 어서션으로 잡는다.
 *
 *   npm run check:analysis-sheet
 *
 * 잡는 것: 반의어 ↔ / 동의어 = 와 옵션 OFF · 같은 끝점 중첩 괄호의 닫기 순서와 라벨 ·
 * 교차 범위 ⚠ · 종합분석 표 라벨(내용 감지) · 다단어 어휘 뜻 묶기 · 문장+어법 상자 묶음.
 * 실패하면 종료 코드 1.
 */
import { buildAnalysisSheetHtml, DEFAULT_SHEET_OPTIONS } from '@/lib/analysis-sheet-html';
import { buildSheetPassages } from '@/lib/analysis-sheet-load';

const S0 = 'She sang alone, and as she opened her mouth to begin, her voice shook.';
//          0   1    2      3   4  5   6      7   8     9  10     11  12    13
const S1 = 'We took a field trip to the park.';
//          0  1    2 3     4    5  6   7

const main = (comp: Record<string, string>) => ({
  sentences: [S0, S1],
  koreanSentences: ['그녀는 노래했다.', '우리는 현장학습을 갔다.'],
  sentenceBreaks: { 0: [3], 1: [] },
  syntaxPhrases: {
    0: [
      { startIndex: 4, endIndex: 10, type: 'clause', label: '시간 부사절' },
      { startIndex: 9, endIndex: 10, type: 'phrase', label: 'to부정사구 (목적)' },
      /* [4-10] 안에서 시작해 밖에서 끝난다 — 저장 데이터 결함. 괄호 대신 ⚠ 로 드러나야 한다 */
      { startIndex: 7, endIndex: 12, type: 'phrase', label: '교차구' },
    ],
    1: [],
  },
  svocData: { 0: { subjectStart: 0, subjectEnd: 0, verbStart: 1, verbEnd: 1 } },
  grammarTags: [
    { sentenceIndex: 0, tagName: '과거시제', selectedText: 'sang', explanation: '과거의 일', category: '시제' },
  ],
  vocabularyList: [
    { word: 'field trip', meaning: '현장학습', partOfSpeech: 'n.', positions: [{ sentence: 1, position: 3 }] },
    { word: 'unsafe', meaning: '안전하지 않은', partOfSpeech: 'adj.', antonym: 'safe', positions: [] },
    { word: 'steady', meaning: '안정된', partOfSpeech: 'adj.', synonym: 'stable', antonym: 'shaky', positions: [] },
  ],
  analysisResults: { comprehensive: comp },
});

const passages = buildSheetPassages([
  { textbook: '합성 교재', sourceKey: '합성 교재 01번', main: main({
    '1': '주제', '2': '요지', '3': '요약',
    '4': '전반부(1~4)는 긴장을 쌓고 후반부로 전환되는 두괄식 구조다.',
    '5': 'taste 를 「맛」으로 직역하면 함정이다.',
  }) },
  { textbook: '합성 교재', sourceKey: '합성 교재 02번', main: main({
    '1': '주제', '2': '요지', '3': '요약',
    '4': '그녀는 혼자 노래를 불렀고 목소리가 떨렸다.',
    '5': '노래는 곧 용기를 뜻한다.',
  }) },
]);

const render = (opt: Partial<typeof DEFAULT_SHEET_OPTIONS>) => buildAnalysisSheetHtml({
  title: '회귀 점검', passages, editionLabel: '해설편', options: opt,
});
const html = render({});
const strip = (s: string) => s.replace(/<[^>]+>/g, '');

let failed = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed += 1;
};

/* 1. 동의어 = · 반의어 ↔, 옵션 OFF 면 둘 다 숨김 */
ok('반의어 ↔ safe', /↔ safe/.test(html) && !/= safe/.test(html));
ok('동의어·반의어 병기 "= stable · ↔ shaky"', /= stable · ↔ shaky/.test(strip(html)));
const off = render({ vocabSynAnt: false });
ok('OFF: = 도 ↔ 도 없음', !/= stable/.test(off) && !/↔ /.test(off));

/* 2. 같은 끝점 중첩 — [ … ( … )라벨 ]라벨 순서 · 교차 범위 ⚠ */
const sent0 = html.split('<div class="sent')[1] ?? '';
const brs = (sent0.match(/class="br"[^>]*>([\[\]()])/g) ?? []).map((x) => x.slice(-1)).join('');
ok(`괄호열 "${brs}" = "[()]"`, brs === '[()]');
const labs = (sent0.match(/class="lab"[^>]*>([^<]+)/g) ?? []).map((x) => x.replace(/^[^>]*>/, ''));
ok(`라벨 순서 안쪽 먼저 ${JSON.stringify(labs)}`,
  labs.some((l) => l.startsWith('to부정사구')) && labs.indexOf(labs.find((l) => l.startsWith('to부정사구'))!) < labs.indexOf('시간 부사절'));
ok('교차 범위는 ⚠ 라벨로 드러남', /⚠교차구 범위 교차/.test(sent0));

/* 3. 종합분석 표 라벨 — 내용 감지 */
const tables = html.match(/<table class="sum">[\s\S]*?<\/table>/g) ?? [];
ok('구조 해설 문서 → 글의 흐름 · 출제 포인트', /<th>글의 흐름<\/th>/.test(tables[0] ?? '') && /<th>출제 포인트<\/th>/.test(tables[0] ?? ''));
ok('실제 해석 문서 → 해석 · 함의 유지', /<th>해석<\/th>/.test(tables[1] ?? '') && /<th>함의<\/th>/.test(tables[1] ?? ''));

/* 4. 다단어 어휘 뜻은 구 전체 아래 한 번 */
const pw = html.match(/<span class="pw">[\s\S]*?<\/span><\/span>/)?.[0] ?? '';
ok('field trip 이 .pw 로 묶임', /field<\/span> <span class="w">trip/.test(pw.replace(/<span class="w[^"]*">/g, '<span class="w">')));
ok('뜻은 묶음 안에 한 번', (pw.match(/class="gl"/g) ?? []).length === 1 && /현장학습/.test(pw));

/* 5. 문장과 어법 상자가 한 묶음(.sb) */
ok('문장 묶음 .sb 개수 = 문장 수', (html.match(/<div class="sb">/g) ?? []).length === 4);
ok('어법 상자가 .sb 안에', /<div class="sb">[\s\S]*?class="gp"[\s\S]*?<\/div><\/div>/.test(html));

if (failed) { console.error(`\n${failed}건 실패`); process.exit(1); }
console.log('\n모두 통과');
