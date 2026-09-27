/**
 * BW-20260921-003 — 어법 G/H 재고 + 워크북키트·강의/수업·전번호 합본 PDF.
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import type { SentenceTokenized } from '@/lib/block-workbook-types';
import {
  syncPointsToModes,
  buildEitherOrHtml,
  buildCorrectionHtml,
  type GrammarPoint,
} from '@/lib/grammar-workbook-html';
import {
  getGrammarWorkbook,
  listGrammarWorkbooks,
  saveGrammarWorkbook,
  type GrammarWorkbookFull,
} from '@/lib/grammar-workbooks-store';
import { loadKitPassagesBySourceKeys } from '@/lib/workbook-kit/load-passages';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import { renderHtmlToPdf, renderHtmlEntriesToZip } from '@/lib/chromium-pdf';
import { buildBulkWorkbookHtml } from '@/lib/grammar-workbook-print';
import { buildLectureMaterialHtml } from '@/lib/lecture-material-html';
import { buildLessonMaterialHtml, type LessonMode } from '@/lib/lesson-material-html';
import { generateWordArrangePassage } from '@/lib/workbook-kit/word-arrange-generate';
import { buildWordArrangeHtml } from '@/lib/workbook-kit/word-arrange-html';

const TEXTBOOK = '맞수 수능문법어법 실전편(2020)';
const KEYS = [
  '04강 01번',
  '04강 02번',
  '04강 03번',
  '04강 04번',
  '05강 01번',
  '05강 02번',
  '05강 03번',
  '05강 04번',
];
const OUT_DIR = path.join(process.env.HOME || '.', 'Downloads', 'BW-20260921-003');

type Pt = {
  sentenceIdx: number;
  correct: string;
  wrong: string[];
  grammarType: string;
  explanation: string;
  koCorrect?: string;
};

function findTokenSpan(tokens: string[], needle: string): { start: number; end: number } | null {
  const want = needle.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      const t = (tokens[i + j] ?? '').replace(/[.,!?;:"]+$/g, '').replace(/^[("]+/g, '');
      const w = want[j].replace(/[.,!?;:"]+$/g, '');
      if (t.toLowerCase() !== w.toLowerCase()) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i, end: i + want.length - 1 };
  }
  return null;
}

function toGrammarPoints(sents: SentenceTokenized[], pts: Pt[]): GrammarPoint[] {
  const out: GrammarPoint[] = [];
  for (const p of pts) {
    const sent = sents.find((s) => s.idx === p.sentenceIdx);
    if (!sent) {
      console.warn('missing sentence', p.sentenceIdx, p.correct);
      continue;
    }
    const span = findTokenSpan(sent.tokens, p.correct);
    if (!span) {
      console.warn('token miss', p.sentenceIdx, JSON.stringify(p.correct), sent.tokens.join(' | '));
      continue;
    }
    out.push({
      id: `S${p.sentenceIdx}-T${span.start}-${Math.random().toString(36).slice(2, 7)}`,
      sentenceIdx: p.sentenceIdx,
      startTokenIdx: span.start,
      endTokenIdx: span.end,
      correctForm: p.correct,
      wrongCandidates: p.wrong,
      grammarType: p.grammarType,
      explanation: p.explanation,
      koCorrect: p.koCorrect,
      uses: ['G', 'H'],
      hRole: 'error',
      jVariant: 'wrong',
    });
  }
  return out;
}

const POINTS_BY_KEY: Record<string, Pt[]> = {
  '04강 01번': [
    { sentenceIdx: 0, correct: 'to', wrong: ['for'], grammarType: '부정사', explanation: 'encourage A to V — to부정사', koCorrect: '구매하도록', uses: undefined as never },
    { sentenceIdx: 1, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'those who — 사람 선행사', koCorrect: '사람들', uses: undefined as never },
    { sentenceIdx: 1, correct: 'feeling', wrong: ['feel'], grammarType: '동명사', explanation: 'end up + -ing', koCorrect: '느끼게', uses: undefined as never },
    { sentenceIdx: 2, correct: 'doing', wrong: ['do'], grammarType: '동명사', explanation: '동명사 주어 doing so', koCorrect: '그렇게 하는 것', uses: undefined as never },
    { sentenceIdx: 2, correct: "don't", wrong: ["doesn't"], grammarType: '수일치', explanation: 'you → don\'t', koCorrect: '필요가 없다', uses: undefined as never },
    { sentenceIdx: 3, correct: 'where', wrong: ['which'], grammarType: '관계사', explanation: '장소 where you shop', koCorrect: '어디에서', uses: undefined as never },
    { sentenceIdx: 3, correct: 'essential', wrong: ['essentially'], grammarType: '품사', explanation: 'be동사 보어 형용사 essential', koCorrect: '필수적인', uses: undefined as never },
    { sentenceIdx: 4, correct: 'becomes', wrong: ['become'], grammarType: '수일치', explanation: 'it → becomes', koCorrect: '쉬워진다', uses: undefined as never },
    { sentenceIdx: 4, correct: 'easier', wrong: ['easily'], grammarType: '품사', explanation: '보어 비교급 형용사 easier', koCorrect: '더 쉬운', uses: undefined as never },
  ],
  '04강 02번': [
    { sentenceIdx: 0, correct: 'differs', wrong: ['differ'], grammarType: '수일치', explanation: 'Friendship → differs', koCorrect: '다르다', uses: undefined as never },
    { sentenceIdx: 0, correct: 'depending', wrong: ['depend'], grammarType: '분사', explanation: '부대상 depending on', koCorrect: '따라', uses: undefined as never },
    { sentenceIdx: 1, correct: 'requires', wrong: ['require'], grammarType: '수일치', explanation: 'friendship → requires', koCorrect: '요구한다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'that', wrong: ['what'], grammarType: '접속사', explanation: 'the fact that 명사절', koCorrect: '라는 사실', uses: undefined as never },
    { sentenceIdx: 2, correct: 'arguing', wrong: ['argue'], grammarType: '동명사', explanation: 'enjoy + -ing', koCorrect: '논쟁하기를', uses: undefined as never },
    { sentenceIdx: 3, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'someone who — 사람', koCorrect: '사람', uses: undefined as never },
    { sentenceIdx: 4, correct: 'making', wrong: ['make'], grammarType: '동명사', explanation: 'good at + -ing', koCorrect: '사귀는', uses: undefined as never },
    { sentenceIdx: 5, correct: 'leaving', wrong: ['leave'], grammarType: '동명사', explanation: 'regret + -ing (한 일을 후회)', koCorrect: '떠난 것을', uses: undefined as never },
    { sentenceIdx: 7, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: '동명사 Sharing 주어 → makes', koCorrect: '되게 한다', uses: undefined as never },
    { sentenceIdx: 7, correct: 'Sharing', wrong: ['Share'], grammarType: '동명사', explanation: '주어 동명사 Sharing', koCorrect: '공유하는 것은', uses: undefined as never },
    { sentenceIdx: 8, correct: 'feel', wrong: ['feels'], grammarType: '수일치', explanation: 'they → feel', koCorrect: '느낀다', uses: undefined as never },
  ],
  '04강 03번': [
    { sentenceIdx: 1, correct: 'might', wrong: ['must'], grammarType: '조동사', explanation: '약한 추측 might be', koCorrect: '일지 모른다', uses: undefined as never },
    { sentenceIdx: 2, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Turritopsis → is unique', koCorrect: '유일하다', uses: undefined as never },
    { sentenceIdx: 3, correct: 'found', wrong: ['finding'], grammarType: '시제', explanation: 'have found 완료', koCorrect: '찾은', uses: undefined as never },
    { sentenceIdx: 4, correct: 'revert', wrong: ['reverts'], grammarType: '부정사', explanation: 'allows it to revert — 원형', koCorrect: '되돌아가게', uses: undefined as never },
    { sentenceIdx: 5, correct: 'called', wrong: ['calling'], grammarType: '분사', explanation: 'process called — 과거분사', koCorrect: '불리는', uses: undefined as never },
    { sentenceIdx: 5, correct: 'change', wrong: ['changing'], grammarType: '부정사', explanation: 'to change — 원형', koCorrect: '바꾸기', uses: undefined as never },
    { sentenceIdx: 6, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: '계속적 용법 , which', koCorrect: '그것은', uses: undefined as never },
    { sentenceIdx: 7, correct: 'creates', wrong: ['create'], grammarType: '수일치', explanation: 'This → creates', koCorrect: '만들어 낸다', uses: undefined as never },
    { sentenceIdx: 7, correct: 'caused', wrong: ['causing'], grammarType: '분사', explanation: 'injuries that caused — 과거', koCorrect: '일으킨', uses: undefined as never },
  ],
  '04강 04번': [
    { sentenceIdx: 0, correct: 'estimated', wrong: ['estimating'], grammarType: '수동태', explanation: 'It is estimated that', koCorrect: '추정된다', uses: undefined as never },
    { sentenceIdx: 0, correct: 'attributed', wrong: ['attributing'], grammarType: '수동태', explanation: 'can be attributed to', koCorrect: '기인하다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'allowed', wrong: ['allowing'], grammarType: '시제', explanation: 'has allowed 현재완료', koCorrect: '해주었다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: '가능성 may also lead', koCorrect: '수도 있다', uses: undefined as never },
    { sentenceIdx: 2, correct: 'contains', wrong: ['contain'], grammarType: '수일치', explanation: 'fertilizer → contains', koCorrect: '포함한다', uses: undefined as never },
    { sentenceIdx: 2, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'chemicals that can', koCorrect: '할 수 있는', uses: undefined as never },
    { sentenceIdx: 3, correct: 'using', wrong: ['use'], grammarType: '동명사', explanation: 'stop + -ing (그만두다)', koCorrect: '사용하는 것을', uses: undefined as never },
    { sentenceIdx: 4, correct: 'would', wrong: ['will'], grammarType: '조동사', explanation: '가정적 결과 would result', koCorrect: '초래할 것이다', uses: undefined as never },
    { sentenceIdx: 5, correct: 'apply', wrong: ['applying'], grammarType: '부정사', explanation: 'option is to apply — 원형', koCorrect: '사용하는 것', uses: undefined as never },
    { sentenceIdx: 5, correct: 'replace', wrong: ['replacing'], grammarType: '부정사', explanation: 'to replace — 원형', koCorrect: '대체하도록', uses: undefined as never },
  ],
  '05강 01번': [
    { sentenceIdx: 0, correct: 'took', wrong: ['takes'], grammarType: '시제', explanation: '과거 took', koCorrect: '채취했다', uses: undefined as never },
    { sentenceIdx: 0, correct: 'measure', wrong: ['measuring'], grammarType: '부정사', explanation: 'to measure — 원형', koCorrect: '측정하기 위해', uses: undefined as never },
    { sentenceIdx: 1, correct: 'found', wrong: ['finding'], grammarType: '분사', explanation: 'plastic found floating — 과거분사', koCorrect: '발견된', uses: undefined as never },
    { sentenceIdx: 1, correct: 'entering', wrong: ['enter'], grammarType: '분사', explanation: 'plastic entering the oceans — 현재분사', koCorrect: '들어가는', uses: undefined as never },
    { sentenceIdx: 2, correct: 'taken', wrong: ['taking'], grammarType: '분사', explanation: 'samples taken from — 과거분사', koCorrect: '채취한', uses: undefined as never },
    { sentenceIdx: 3, correct: 'found', wrong: ['finding'], grammarType: '시제', explanation: 'seems to have found 완료부정사', koCorrect: '찾아낸', uses: undefined as never },
    { sentenceIdx: 4, correct: 'contained', wrong: ['contain'], grammarType: '시제', explanation: '과거 contained', koCorrect: '포함했다', uses: undefined as never },
    { sentenceIdx: 5, correct: 'confuse', wrong: ['confuses'], grammarType: '수일치', explanation: 'animals → confuse', koCorrect: '혼동한다', uses: undefined as never },
    { sentenceIdx: 6, correct: 'can', wrong: ['must'], grammarType: '조동사', explanation: '가능성 can easily poison', koCorrect: '수 있다', uses: undefined as never },
    { sentenceIdx: 7, correct: 'should', wrong: ['must'], grammarType: '조동사', explanation: '권고 should stop', koCorrect: '해야 한다', uses: undefined as never },
    { sentenceIdx: 7, correct: 'think', wrong: ['thinking'], grammarType: '부정사', explanation: 'stop to think — 원형 (생각하려고 멈추다)', koCorrect: '생각하려고', uses: undefined as never },
  ],
  '05강 02번': [
    { sentenceIdx: 0, correct: 'felt', wrong: ['feeling'], grammarType: '수동태', explanation: 'can be felt — 과거분사', koCorrect: '느껴질', uses: undefined as never },
    { sentenceIdx: 0, correct: 'played', wrong: ['playing'], grammarType: '분사', explanation: 'tune played on — 과거분사', koCorrect: '연주되는', uses: undefined as never },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Music → is', koCorrect: '이다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'played', wrong: ['play'], grammarType: '시제', explanation: 'may have played 완료', koCorrect: '했을지도', uses: undefined as never },
    { sentenceIdx: 2, correct: 'communicate', wrong: ['communicating'], grammarType: '부정사', explanation: 'need to communicate — 원형', koCorrect: '알리기', uses: undefined as never },
    { sentenceIdx: 3, correct: 'maintain', wrong: ['maintains'], grammarType: '수일치', explanation: 'primates → maintain', koCorrect: '유지한다', uses: undefined as never },
    { sentenceIdx: 4, correct: 'needed', wrong: ['need'], grammarType: '시제', explanation: '과거 needed', koCorrect: '필요했다', uses: undefined as never },
    { sentenceIdx: 4, correct: 'broadcast', wrong: ['broadcasting'], grammarType: '부정사', explanation: 'a way to broadcast — 원형', koCorrect: '알릴', uses: undefined as never },
    { sentenceIdx: 5, correct: 'led', wrong: ['lead'], grammarType: '시제', explanation: '과거 led', koCorrect: '이끌었다', uses: undefined as never },
    { sentenceIdx: 5, correct: 'begin', wrong: ['beginning'], grammarType: '부정사', explanation: 'led A to begin — 원형', koCorrect: '시작하도록', uses: undefined as never },
    { sentenceIdx: 6, correct: 'regarded', wrong: ['regarding'], grammarType: '수동태', explanation: 'is regarded by — 과거분사', koCorrect: '간주된다', uses: undefined as never },
    { sentenceIdx: 6, correct: 'strengthen', wrong: ['strengthening'], grammarType: '부정사', explanation: 'to strengthen — 원형', koCorrect: '강화하기 위해', uses: undefined as never },
  ],
  '05강 03번': [
    { sentenceIdx: 0, correct: 'classified', wrong: ['classifying'], grammarType: '수동태', explanation: 'can be classified — 과거분사', koCorrect: '분류될', uses: undefined as never },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'learners → are', koCorrect: '이다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'people who depend', koCorrect: '사람들', uses: undefined as never },
    { sentenceIdx: 3, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'imaginations → are', koCorrect: '뛰어나고', uses: undefined as never },
    { sentenceIdx: 3, correct: 'picture', wrong: ['picturing'], grammarType: '부정사', explanation: 'enough to picture — 원형', koCorrect: '그려낼', uses: undefined as never },
    { sentenceIdx: 4, correct: 'listen', wrong: ['listening'], grammarType: '부정사', explanation: 'hard to listen — 원형', koCorrect: '듣는', uses: undefined as never },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'there are no pictures', koCorrect: '없다면', uses: undefined as never },
    { sentenceIdx: 5, correct: 'use', wrong: ['using'], grammarType: '부정사', explanation: 'useful to use — 원형', koCorrect: '사용하는', uses: undefined as never },
    { sentenceIdx: 6, correct: 'used', wrong: ['using'], grammarType: '수동태', explanation: 'can be used — 과거분사', koCorrect: '사용될', uses: undefined as never },
    { sentenceIdx: 6, correct: 'help', wrong: ['helping'], grammarType: '부정사', explanation: 'used to help — 원형', koCorrect: '도움을 주기', uses: undefined as never },
  ],
  '05강 04번': [
    { sentenceIdx: 0, correct: 'believe', wrong: ['believes'], grammarType: '수일치', explanation: 'people → believe', koCorrect: '믿는다', uses: undefined as never },
    { sentenceIdx: 0, correct: 'suggests', wrong: ['suggest'], grammarType: '수일치', explanation: 'evidence → suggests', koCorrect: '시사한다', uses: undefined as never },
    { sentenceIdx: 1, correct: 'composed', wrong: ['composing'], grammarType: '수동태', explanation: 'is composed of', koCorrect: '구성되어', uses: undefined as never },
    { sentenceIdx: 1, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: '계속적 , which is why', koCorrect: '그것이', uses: undefined as never },
    { sentenceIdx: 2, correct: 'considered', wrong: ['considering'], grammarType: '수동태', explanation: "It's considered a must", koCorrect: '여겨진다', uses: undefined as never },
    { sentenceIdx: 2, correct: 'keep', wrong: ['keeping'], grammarType: '부정사', explanation: 'want to keep — 원형', koCorrect: '유지하기를', uses: undefined as never },
    { sentenceIdx: 3, correct: "wouldn't", wrong: ["won't"], grammarType: '가정법', explanation: "가정법 과거 wouldn't be able", koCorrect: '없을 것이다', uses: undefined as never },
    { sentenceIdx: 3, correct: "didn't", wrong: ["don't"], grammarType: '가정법', explanation: 'if you didn\'t get — 가정법 과거', koCorrect: '얻지 못하면', uses: undefined as never },
    { sentenceIdx: 4, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'a brain → has to', koCorrect: '해야 한다', uses: undefined as never },
    { sentenceIdx: 4, correct: 'devote', wrong: ['devoting'], grammarType: '부정사', explanation: 'has to devote — 원형', koCorrect: '쏟아야', uses: undefined as never },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'people → are shocked', koCorrect: '충격을 받는다', uses: undefined as never },
    { sentenceIdx: 5, correct: 'helps', wrong: ['help'], grammarType: '수일치', explanation: 'water → helps', koCorrect: '도움을 준다', uses: undefined as never },
  ],
};

async function saveGrammarForPassage(
  passageId: string,
  sourceKey: string,
  sents: SentenceTokenized[],
  pts: Pt[],
) {
  const points = toGrammarPoints(sents, pts);
  const sync = syncPointsToModes(points, sents);
  const modes = ['G', 'H'] as ('G' | 'H')[];
  const modeData = {
    P: { points },
    G: { points: sync.eitherOrPoints },
    H: { spans: sync.correctionSpans },
  };
  const title = `${TEXTBOOK} ${sourceKey} 어법공략`;
  const buildOpts = { title, textbook: TEXTBOOK, sourceKey };
  const html = {
    G: buildEitherOrHtml({ ...buildOpts, sentences: sents, points: modeData.G.points }),
    H: buildCorrectionHtml({ ...buildOpts, sentences: sents, spans: modeData.H.spans }),
  };
  const result = await saveGrammarWorkbook({
    passageId,
    textbook: TEXTBOOK,
    sourceKey,
    title,
    folder: '기본',
    examMeta: {},
    sentences: sents,
    modes,
    modeData,
    html,
  });
  return { ...result, g: modeData.G.points.length, h: modeData.H.spans.length, points: points.length };
}

async function loadDocsInOrder(): Promise<GrammarWorkbookFull[]> {
  const listed = await listGrammarWorkbooks({ textbook: TEXTBOOK, limit: 400 });
  const byKey = new Map(listed.map((r) => [r.sourceKey, r]));
  const docs: GrammarWorkbookFull[] = [];
  for (const k of KEYS) {
    const row = byKey.get(k);
    if (!row) continue;
    const full = await getGrammarWorkbook(row._id);
    if (full) docs.push(full);
  }
  return docs;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = await getDb('gomijoshua');
  const margin = { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' };

  console.log('=== 1) 어법 G/H ===');
  for (const key of KEYS) {
    const doc = await db.collection('passages').findOne({ textbook: TEXTBOOK, source_key: key });
    if (!doc) {
      console.error('missing passage', key);
      continue;
    }
    const content = (doc as { content?: Parameters<typeof tokenizePassageFromContent>[0] }).content;
    const sents = tokenizePassageFromContent(content ?? null);
    const pts = POINTS_BY_KEY[key] ?? [];
    const r = await saveGrammarForPassage(String(doc._id), key, sents, pts);
    console.log(key, 'saved', r.id, `points=${r.points} G=${r.g} H=${r.h}`, r.created ? 'created' : 'updated');
  }

  console.log('=== 2) 워크북키트 ===');
  const passages = await loadKitPassagesBySourceKeys(TEXTBOOK, KEYS);
  const kitEntries = await buildWorkbookKitEntries(passages, {
    types: [
      'blank_adj',
      'blank_keyword',
      'blank_noun',
      'blank_prep',
      'blank_verb',
      'word_arrange',
      'grammar_either_or',
      'grammar_correction',
    ],
    includeTranslation: true,
  });
  const usable = kitEntries.filter((e) => e.html);
  for (const e of kitEntries) {
    console.log(e.type, e.questionCount, e.warning || 'ok');
  }
  if (usable.length) {
    const zip = await renderHtmlEntriesToZip(
      usable.map((e) => ({ fileName: e.fileName, html: e.html })),
      { margin },
    );
    fs.writeFileSync(path.join(OUT_DIR, '워크북키트_빈칸_낱말_어법.zip'), zip);
    console.log('kit zip', zip.length);
  }

  console.log('=== 3) 어법 전번호 합본 + 낱말배열 ===');
  const docs = await loadDocsInOrder();
  const gBulk = buildBulkWorkbookHtml(docs, {
    modes: ['G'],
    includePoints: false,
    layout: 'back',
    title: `${TEXTBOOK} 어법 양자택일 합본`,
  });
  if (!gBulk) throw new Error('G 합본 실패');
  const gPdf = await renderHtmlToPdf(gBulk.html, { margin });
  fs.writeFileSync(path.join(OUT_DIR, '어법_양자택일_전번호합본.pdf'), gPdf);
  console.log('G', gPdf.length);

  const hBulk = buildBulkWorkbookHtml(docs, {
    modes: ['H'],
    includePoints: false,
    layout: 'back',
    title: `${TEXTBOOK} 어법 오류수정 합본`,
  });
  if (!hBulk) throw new Error('H 합본 실패');
  const hPdf = await renderHtmlToPdf(hBulk.html, { margin });
  fs.writeFileSync(path.join(OUT_DIR, '어법_오류수정_전번호합본.pdf'), hPdf);
  console.log('H', hPdf.length);

  const arrange = passages.map(generateWordArrangePassage).filter((r) => r.items.length > 0);
  const arrangePdf = await renderHtmlToPdf(buildWordArrangeHtml(arrange, { textbook: TEXTBOOK }), { margin });
  fs.writeFileSync(path.join(OUT_DIR, '낱말배열_전번호합본.pdf'), arrangePdf);
  console.log('arrange', arrangePdf.length);

  console.log('=== 4) 강의용 · 한줄/영작/해석 ===');
  const lessonModes: LessonMode[] = ['lineByLine', 'writeEn', 'writeKo'];
  const lectureParts: string[] = [];
  const lessonParts: Record<LessonMode, string[]> = { lineByLine: [], writeEn: [], writeKo: [], parallel: [] };
  for (const p of passages) {
    const pairs = p.sentencesEn.map((en, i) => ({ idx: i, en, ko: p.sentencesKo[i] ?? '' }));
    lectureParts.push(
      buildLectureMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        sentences: p.sentencesEn.map((text, idx) => ({ idx, text })),
        kicker: '강의용자료',
      }),
    );
    for (const mode of lessonModes) {
      lessonParts[mode].push(
        buildLessonMaterialHtml({
          title: TEXTBOOK,
          chapter: p.chapter,
          number: p.number.replace(/번$/, ''),
          mode,
          sentences: pairs,
          kicker: mode === 'lineByLine' ? '한줄해석' : mode === 'writeEn' ? '영작하기' : '해석쓰기',
        }),
      );
    }
  }
  const lessonMargin = { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' };
  const lectureZip = await renderHtmlEntriesToZip(
    lectureParts.map((html, i) => ({ fileName: `강의용/${passages[i].sourceKey}.pdf`, html })),
    { margin: lessonMargin },
  );
  fs.writeFileSync(path.join(OUT_DIR, '강의용자료.zip'), lectureZip);
  console.log('강의용', lectureZip.length);
  const packs: [string, LessonMode][] = [
    ['한줄해석.zip', 'lineByLine'],
    ['영작하기.zip', 'writeEn'],
    ['해석쓰기.zip', 'writeKo'],
  ];
  for (const [name, mode] of packs) {
    const zip = await renderHtmlEntriesToZip(
      lessonParts[mode].map((html, i) => ({
        fileName: `${name.replace('.zip', '')}/${passages[i].sourceKey}.pdf`,
        html,
      })),
      { margin: lessonMargin },
    );
    fs.writeFileSync(path.join(OUT_DIR, name), zip);
    console.log(name, zip.length);
  }

  const parent = path.dirname(OUT_DIR);
  const base = path.basename(OUT_DIR);
  const zipPath = path.join(parent, `${base}.zip`);
  fs.rmSync(zipPath, { force: true });
  execSync(`/usr/bin/zip -r ${JSON.stringify(zipPath)} ${JSON.stringify(base)}`, { cwd: parent, stdio: 'inherit' });
  console.log('DONE', OUT_DIR, fs.statSync(zipPath).size);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
