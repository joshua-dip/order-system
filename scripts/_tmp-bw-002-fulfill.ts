/**
 * BW-20260921-002 — 어법 G/H 재고 + 워크북키트·강의/수업·전번호 합본 PDF.
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

const TEXTBOOK = '맞수 수능문법어법 기본편(2020)';
const KEYS = [
  '10강 01번',
  '10강 02번',
  '10강 03번',
  '10강 04번',
  '11강 01번',
  '11강 02번',
  '11강 03번',
  '11강 04번',
];
const OUT_DIR = path.join(process.env.HOME || '.', 'Downloads', 'BW-20260921-002');

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
  '10강 01번': [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'An ice cream headache → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'get', wrong: ['gets'], grammarType: '수일치', explanation: 'you → get', koCorrect: '겪는' },
    { sentenceIdx: 1, correct: 'causes', wrong: ['cause'], grammarType: '수일치', explanation: 'what causes — 주어 what', koCorrect: '생기게 하는' },
    { sentenceIdx: 2, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'The temperature → makes', koCorrect: '만든다' },
    { sentenceIdx: 2, correct: 'located', wrong: ['locating'], grammarType: '분사', explanation: 'vessels located — 과거분사', koCorrect: '위치한' },
    { sentenceIdx: 3, correct: 'sends', wrong: ['send'], grammarType: '수일치', explanation: 'your brain → sends', koCorrect: '보낸다' },
    { sentenceIdx: 3, correct: 'ordering', wrong: ['ordered'], grammarType: '분사', explanation: 'message ordering — 현재분사', koCorrect: '명령하는' },
    { sentenceIdx: 4, correct: 'causes', wrong: ['cause'], grammarType: '수일치', explanation: 'This sudden relaxation → causes', koCorrect: '한다' },
    { sentenceIdx: 4, correct: 'released', wrong: ['releasing'], grammarType: '수동태', explanation: 'to be released — 과거분사', koCorrect: '방출되도록' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The result → is', koCorrect: '이다' },
    { sentenceIdx: 5, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'pain that can last', koCorrect: '지속할 수 있는' },
    { sentenceIdx: 6, correct: 'make', wrong: ['making'], grammarType: '부정사', explanation: 'enough to make — 원형', koCorrect: '만들' },
  ],
  '10강 02번': [
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Libraries → are', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'filled', wrong: ['filling'], grammarType: '분사', explanation: 'rooms filled with — 과거분사', koCorrect: '가득 찬' },
    { sentenceIdx: 1, correct: 'hosts', wrong: ['host'], grammarType: '수일치', explanation: 'The New York Public Library → hosts', koCorrect: '주최한다' },
    { sentenceIdx: 2, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Other libraries → are transforming', koCorrect: '바꾸고 있다' },
    { sentenceIdx: 3, correct: 'offer', wrong: ['offers'], grammarType: '수일치', explanation: 'Some → offer', koCorrect: '제공한다' },
    { sentenceIdx: 3, correct: 'allow', wrong: ['allowing'], grammarType: '부정사', explanation: 'spaces to allow — 원형', koCorrect: '하게 하는' },
    { sentenceIdx: 4, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'the role → has become', koCorrect: '되어 있다' },
    { sentenceIdx: 4, correct: 'providing', wrong: ['provided'], grammarType: '분사', explanation: '부대상 providing', koCorrect: '제공하면서' },
    { sentenceIdx: 5, correct: 'collect', wrong: ['collects'], grammarType: '수일치', explanation: 'libraries → collect', koCorrect: '수집한다' },
    { sentenceIdx: 5, correct: 'publishing', wrong: ['publish'], grammarType: '동명사', explanation: 'before + -ing', koCorrect: '공개하기 전에' },
    { sentenceIdx: 6, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'Such changes → have revived', koCorrect: '되살리고 있다' },
  ],
  '10강 03번': [
    { sentenceIdx: 0, correct: 'knows', wrong: ['know'], grammarType: '수일치', explanation: 'Everyone → knows', koCorrect: '안다' },
    { sentenceIdx: 0, correct: 'covered', wrong: ['covering'], grammarType: '수동태', explanation: 'should be covered — 과거분사', koCorrect: '덮여' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'What they dont know → is', koCorrect: '이다' },
    { sentenceIdx: 1, correct: 'prevent', wrong: ['preventing'], grammarType: '부정사', explanation: 'how to prevent — 원형', koCorrect: '예방하는' },
    { sentenceIdx: 2, correct: "won't", wrong: ["doesn't"], grammarType: '시제', explanation: '미래 부정 wont be', koCorrect: '되지 않을' },
    { sentenceIdx: 3, correct: 'Designed', wrong: ['Designing'], grammarType: '분사', explanation: '과거분사 부대상 Designed with', koCorrect: '설계되어' },
    { sentenceIdx: 3, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'sensors that monitor', koCorrect: '하는' },
    { sentenceIdx: 5, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'sensors, which can evaluate', koCorrect: '그것은' },
    { sentenceIdx: 5, correct: 'adjust', wrong: ['adjusting'], grammarType: '부정사', explanation: 'can adjust — 원형', koCorrect: '조정되도록' },
    { sentenceIdx: 6, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'antibiotics and medication → are delivered', koCorrect: '전달된다' },
    { sentenceIdx: 6, correct: 'detect', wrong: ['detects'], grammarType: '수일치', explanation: 'sensors → detect', koCorrect: '감지하면' },
    { sentenceIdx: 7, correct: 'predict', wrong: ['predicts'], grammarType: '수일치', explanation: 'Doctors → predict', koCorrect: '예측한다' },
  ],
  '10강 04번': [
    { sentenceIdx: 0, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'The IoT → makes', koCorrect: '가능하게 한다' },
    { sentenceIdx: 0, correct: 'connect', wrong: ['connecting'], grammarType: '부정사', explanation: 'possible to connect — 원형', koCorrect: '연결하는' },
    { sentenceIdx: 1, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'it → has the potential', koCorrect: '지니고 있다' },
    { sentenceIdx: 1, correct: 'change', wrong: ['changing'], grammarType: '부정사', explanation: 'not only to change — 원형', koCorrect: '바꾸는' },
    { sentenceIdx: 2, correct: 'had', wrong: ['have'], grammarType: '가정법', explanation: 'if you had — 가정법 과거', koCorrect: '있다면' },
    { sentenceIdx: 2, correct: 'could', wrong: ['can'], grammarType: '가정법', explanation: '가정법 could access', koCorrect: '수 있다' },
    { sentenceIdx: 3, correct: 'got', wrong: ['get'], grammarType: '가정법', explanation: 'if you got stuck — 가정법', koCorrect: '겪고 있다면' },
    { sentenceIdx: 3, correct: 'notifying', wrong: ['notified'], grammarType: '분사', explanation: 'messages notifying — 현재분사', koCorrect: '알리는' },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Possibilities → are', koCorrect: '무궁무진하다' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Discussions → are taking place', koCorrect: '이뤄지고' },
    { sentenceIdx: 5, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'try to understand — 원형', koCorrect: '이해하려고' },
    { sentenceIdx: 5, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'ways in which it could', koCorrect: '방식으로' },
  ],
  '11강 01번': [
    { sentenceIdx: 0, correct: 'wondered', wrong: ['wonder'], grammarType: '시제', explanation: 'Have you ever wondered — 과거분사', koCorrect: '궁금해한' },
    { sentenceIdx: 0, correct: 'comes', wrong: ['come'], grammarType: '수일치', explanation: 'dust → comes', koCorrect: '오는지' },
    { sentenceIdx: 1, correct: 'seems', wrong: ['seem'], grammarType: '수일치', explanation: 'It → seems', koCorrect: '같다' },
    { sentenceIdx: 1, correct: 'gather', wrong: ['gathers'], grammarType: '조동사', explanation: 'can gather — 원형', koCorrect: '모일' },
    { sentenceIdx: 2, correct: "isn't", wrong: ["aren't"], grammarType: '수일치', explanation: 'there isnt more of it', koCorrect: '없다는' },
    { sentenceIdx: 3, correct: 'use', wrong: ['uses'], grammarType: '수일치', explanation: 'you → use', koCorrect: '사용하지' },
    { sentenceIdx: 3, correct: 'coming', wrong: ['came'], grammarType: '분사', explanation: 'air coming in — 현재분사', koCorrect: '들어온' },
    { sentenceIdx: 3, correct: 'carries', wrong: ['carry'], grammarType: '수일치', explanation: 'air → carries', koCorrect: '운반한다' },
    { sentenceIdx: 4, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'what makes up — 주어 what', koCorrect: '구성하는' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Another component → is', koCorrect: '있다' },
    { sentenceIdx: 5, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'cells that each human drops', koCorrect: '떨어뜨리는' },
    { sentenceIdx: 6, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'they are used', koCorrect: '사용될' },
    { sentenceIdx: 7, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'homes that are carpeted', koCorrect: '깔린' },
    { sentenceIdx: 7, correct: 'gather', wrong: ['gathers'], grammarType: '수일치', explanation: 'fibers → gather', koCorrect: '모여서' },
  ],
  '11강 02번': [
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Soft drinks → are', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'made', wrong: ['making'], grammarType: '분사', explanation: 'beverages made with — 과거분사', koCorrect: '만들어진' },
    { sentenceIdx: 1, correct: 'would', wrong: ['will'], grammarType: '조동사', explanation: 'little would you imagine — 도치', koCorrect: '상상하지' },
    { sentenceIdx: 1, correct: 'contain', wrong: ['contains'], grammarType: '수일치', explanation: 'they → contain', koCorrect: '함유하고' },
    { sentenceIdx: 2, correct: 'showed', wrong: ['shows'], grammarType: '시제', explanation: '과거 showed', koCorrect: '밝혀졌다' },
    { sentenceIdx: 2, correct: 'do', wrong: ['does'], grammarType: '조동사', explanation: 'drinks do contain — 강조 do', koCorrect: '정말로' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'This → is primarily due', koCorrect: '때문이다' },
    { sentenceIdx: 3, correct: 'occurring', wrong: ['occurred'], grammarType: '분사', explanation: 'naturally occurring — 현재분사', koCorrect: '일어나는' },
    { sentenceIdx: 4, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'alcohol → is introduced', koCorrect: '들어가게' },
    { sentenceIdx: 4, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'extracts that are used', koCorrect: '사용되는' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'minors are not allowed', koCorrect: '허락되지' },
    { sentenceIdx: 6, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'To better understand — 원형', koCorrect: '이해하기' },
    { sentenceIdx: 6, correct: 'contain', wrong: ['contains'], grammarType: '조동사', explanation: 'will contain — 원형', koCorrect: '포함할' },
  ],
  '11강 03번': [
    { sentenceIdx: 0, correct: 'found', wrong: ['finding'], grammarType: '시제', explanation: 'A study found — 과거', koCorrect: '발견했다' },
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'older people → are not good', koCorrect: '능숙하지' },
    { sentenceIdx: 0, correct: 'taking', wrong: ['take'], grammarType: '동명사', explanation: 'good at + -ing', koCorrect: '받아들이는' },
    { sentenceIdx: 1, correct: 'were', wrong: ['was'], grammarType: '수동태', explanation: 'people were shown — 과거', koCorrect: '보여주었는데' },
    { sentenceIdx: 1, correct: 'moving', wrong: ['moved'], grammarType: '분사', explanation: 'moving dots — 현재분사', koCorrect: '움직이는' },
    { sentenceIdx: 2, correct: 'were', wrong: ['was'], grammarType: '수동태', explanation: 'they were asked', koCorrect: '질문을 받았다' },
    { sentenceIdx: 2, correct: 'had', wrong: ['have'], grammarType: '시제', explanation: 'numbers they had seen — 과거완료', koCorrect: '봤던' },
    { sentenceIdx: 3, correct: 'mentioned', wrong: ['mention'], grammarType: '시제', explanation: '과거 mentioned', koCorrect: '언급했다' },
    { sentenceIdx: 3, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'this information → was', koCorrect: '없는데도' },
    { sentenceIdx: 4, correct: 'could', wrong: ['can'], grammarType: '조동사', explanation: '가능성 could be distracting', koCorrect: '할 수 있는데' },
    { sentenceIdx: 4, correct: 'replacing', wrong: ['replace'], grammarType: '동명사', explanation: 'risks + -ing', koCorrect: '대체할' },
    { sentenceIdx: 5, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'information → was presented', koCorrect: '제시될수록' },
    { sentenceIdx: 5, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'the seniors → were able', koCorrect: '못했다' },
    { sentenceIdx: 6, correct: 'explain', wrong: ['explains'], grammarType: '조동사', explanation: 'could explain — 원형', koCorrect: '설명할' },
    { sentenceIdx: 6, correct: 'involving', wrong: ['involved'], grammarType: '분사', explanation: 'tasks involving — 현재분사', koCorrect: '포함된' },
  ],
  '11강 04번': [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Separation anxiety → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'occurs', wrong: ['occur'], grammarType: '수일치', explanation: 'stage that occurs', koCorrect: '발생하는' },
    { sentenceIdx: 0, correct: 'begin', wrong: ['begins'], grammarType: '수일치', explanation: 'babies → begin', koCorrect: '시작할' },
    { sentenceIdx: 1, correct: 'comprehend', wrong: ['comprehends'], grammarType: '수일치', explanation: 'they → comprehend', koCorrect: '이해하는데' },
    { sentenceIdx: 1, correct: 'realize', wrong: ['realizes'], grammarType: '수일치', explanation: 'they → realize', koCorrect: '알게' },
    { sentenceIdx: 1, correct: 'continues', wrong: ['continue'], grammarType: '수일치', explanation: 'something → continues', koCorrect: '계속' },
    { sentenceIdx: 2, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'babies → are able', koCorrect: '할 수는' },
    { sentenceIdx: 2, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'able to understand — 원형', koCorrect: '이해할' },
    { sentenceIdx: 2, correct: "don't", wrong: ["doesn't"], grammarType: '수일치', explanation: 'they → dont understand', koCorrect: '알지는' },
    { sentenceIdx: 3, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'Nor do they have', koCorrect: '하지도' },
    { sentenceIdx: 4, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The reaction → is', koCorrect: '것이다' },
    { sentenceIdx: 4, correct: 'known', wrong: ['knowing'], grammarType: '수동태', explanation: 'what is known as', koCorrect: '알려진' },
    { sentenceIdx: 5, correct: 'begins', wrong: ['begin'], grammarType: '수일치', explanation: 'It → begins', koCorrect: '시작되어' },
    { sentenceIdx: 5, correct: 'starts', wrong: ['start'], grammarType: '수일치', explanation: 'it → starts to decline', koCorrect: '시작한다' },
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
  const arrangePdf = await renderHtmlToPdf(buildWordArrangeHtml(arrange, { textbook: TEXTBOOK }), {
    margin,
  });
  fs.writeFileSync(path.join(OUT_DIR, '낱말배열_전번호합본.pdf'), arrangePdf);
  console.log('arrange', arrangePdf.length);

  console.log('=== 4) 강의용 · 한줄/영작/해석 ===');
  const lessonModes: LessonMode[] = ['lineByLine', 'writeEn', 'writeKo'];
  const lectureParts: string[] = [];
  const lessonParts: Record<LessonMode, string[]> = {
    lineByLine: [],
    writeEn: [],
    writeKo: [],
    parallel: [],
  };
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
  execSync(`/usr/bin/zip -r ${JSON.stringify(zipPath)} ${JSON.stringify(base)}`, {
    cwd: parent,
    stdio: 'inherit',
  });
  console.log('DONE', OUT_DIR, fs.statSync(zipPath).size);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
