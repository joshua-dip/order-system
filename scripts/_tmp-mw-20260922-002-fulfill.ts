/**
 * MW-20260922-002 — 25년 9월 고2 영어모의고사 29~34번 어법 양자택일.
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
import { passageFromDoc } from '@/lib/workbook-kit/build';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import type { KitPassageInput } from '@/lib/workbook-kit/types';
import { renderHtmlToPdf, renderHtmlEntriesToZip } from '@/lib/chromium-pdf';
import { buildBulkWorkbookHtml } from '@/lib/grammar-workbook-print';

const TEXTBOOK = '25년 9월 고2 영어모의고사';
const NUMS = ['29', '30', '31', '32', '33', '34'];
const KEYS = NUMS.map((n) => `${TEXTBOOK} ${n}번`);
const ORDER = 'MW-20260922-002';
const OUT_DIR = path.join(process.env.HOME || '.', 'Downloads', ORDER);

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
      const t = (tokens[i + j] ?? '').replace(/[.,!?;:"']+$/g, '').replace(/^["'(]+/g, '');
      const w = want[j].replace(/[.,!?;:"']+$/g, '');
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
  [`${TEXTBOOK} 29번`]: [
    { sentenceIdx: 0, correct: 'mark', wrong: ['marks'], grammarType: '수일치', explanation: 'All human cultures → mark', koCorrect: '표시한다' },
    { sentenceIdx: 0, correct: 'they', wrong: ['it'], grammarType: '대명사', explanation: 'differences they observe — cultures', koCorrect: '그들이' },
    { sentenceIdx: 0, correct: 'observe', wrong: ['observes'], grammarType: '수일치', explanation: 'they → observe', koCorrect: '관찰하는' },
    { sentenceIdx: 1, correct: 'depends', wrong: ['depend'], grammarType: '수일치', explanation: 'Our choice → depends', koCorrect: '달려 있다' },
    { sentenceIdx: 1, correct: 'mark', wrong: ['marking'], grammarType: '부정사', explanation: 'to mark — 원형', koCorrect: '표시할' },
    { sentenceIdx: 1, correct: 'observe', wrong: ['observing'], grammarType: '부정사', explanation: 'can observe — 원형', koCorrect: '관찰할' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'what → is important', koCorrect: '중요한' },
    { sentenceIdx: 2, correct: 'depends', wrong: ['depend'], grammarType: '수일치', explanation: 'How we mark ... → depends', koCorrect: '달려 있다' },
    { sentenceIdx: 2, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'we → make', koCorrect: '만드는' },
    { sentenceIdx: 3, correct: 'where', wrong: ['which'], grammarType: '관계사', explanation: 'Europe, where ... make', koCorrect: '그곳에서' },
    { sentenceIdx: 3, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'higher latitudes → make', koCorrect: '만든다' },
    { sentenceIdx: 3, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'it → was natural', koCorrect: '자연스러웠다' },
    { sentenceIdx: 3, correct: 'monitor', wrong: ['monitoring'], grammarType: '부정사', explanation: 'natural to monitor — 원형', koCorrect: '관찰하는' },
    { sentenceIdx: 4, correct: 'whom', wrong: ['who'], grammarType: '관계사', explanation: 'for whom — 목적격', koCorrect: '그들에게' },
    { sentenceIdx: 4, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'seasonal changes → were', koCorrect: '덜 중요했다' },
    { sentenceIdx: 4, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'the lunar calendar → was', koCorrect: '이었다' },
    { sentenceIdx: 5, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'That → did not make', koCorrect: '만들지' },
    { sentenceIdx: 5, correct: 'would', wrong: ['will'], grammarType: '조동사', explanation: 'Islam would use — 과거 시점 미래', koCorrect: '사용할' },
    { sentenceIdx: 5, correct: 'were', wrong: ['was'], grammarType: '수동태', explanation: 'decisions → were made', koCorrect: '이루어졌다' },
    { sentenceIdx: 5, correct: 'limited', wrong: ['limiting'], grammarType: '분사', explanation: 'options limited by — 과거분사', koCorrect: '제한된' },
    { sentenceIdx: 5, correct: 'filtered', wrong: ['filtering'], grammarType: '분사', explanation: 'filtered through — 과거분사', koCorrect: '걸러진' },
  ],
  [`${TEXTBOOK} 30번`]: [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'empathy → is widely praised', koCorrect: '칭송되지만' },
    { sentenceIdx: 0, correct: 'praised', wrong: ['praising'], grammarType: '수동태', explanation: 'is praised — 과거분사', koCorrect: '칭송되는' },
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'not everyone → is', koCorrect: '아니다' },
    { sentenceIdx: 1, correct: 'argue', wrong: ['argues'], grammarType: '수일치', explanation: 'Critics → argue', koCorrect: '주장한다' },
    { sentenceIdx: 1, correct: 'will', wrong: ['would'], grammarType: '시제', explanation: '미래 will not save', koCorrect: '구하지' },
    { sentenceIdx: 1, correct: 'save', wrong: ['saving'], grammarType: '부정사', explanation: 'will not save — 원형', koCorrect: '구할' },
    { sentenceIdx: 2, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'empathy → makes', koCorrect: '만든다' },
    { sentenceIdx: 3, correct: 'maintain', wrong: ['maintains'], grammarType: '수일치', explanation: 'These critics → maintain', koCorrect: '주장한다' },
    { sentenceIdx: 3, correct: 'lead', wrong: ['leads'], grammarType: '수일치', explanation: 'empathy ... can ... lead', koCorrect: '이끌' },
    { sentenceIdx: 4, correct: 'argue', wrong: ['argues'], grammarType: '수일치', explanation: 'They → argue', koCorrect: '주장한다' },
    { sentenceIdx: 4, correct: 'tend', wrong: ['tends'], grammarType: '수일치', explanation: 'we → tend', koCorrect: '경향이 있다' },
    { sentenceIdx: 4, correct: 'empathize', wrong: ['empathizing'], grammarType: '부정사', explanation: 'tend to empathize — 원형', koCorrect: '공감하는' },
    { sentenceIdx: 4, correct: 'empathizing', wrong: ['empathize'], grammarType: '동명사', explanation: 'resist + -ing', koCorrect: '공감하는 것을' },
    { sentenceIdx: 4, correct: 'enjoy', wrong: ['enjoys'], grammarType: '수일치', explanation: 'and even enjoy — we 주어', koCorrect: '즐기기까지' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'the prescription → is', koCorrect: '이다' },
    { sentenceIdx: 6, correct: 'encourage', wrong: ['encourages'], grammarType: '수일치', explanation: 'Empathy ... can ... encourage', koCorrect: '부추길' },
    { sentenceIdx: 6, correct: 'force', wrong: ['forcing'], grammarType: '부정사', explanation: 'and force — 원형 병렬', koCorrect: '몰아넣을' },
    { sentenceIdx: 7, correct: 'try', wrong: ['tries'], grammarType: '수일치', explanation: 'we → try', koCorrect: '시도할' },
    { sentenceIdx: 7, correct: 'empathize', wrong: ['empathizing'], grammarType: '부정사', explanation: 'try to empathize — 원형', koCorrect: '공감하려고' },
    { sentenceIdx: 7, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'others who are dissimilar', koCorrect: '다른' },
    { sentenceIdx: 7, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'we → are unable', koCorrect: '할 수 없어' },
    { sentenceIdx: 7, correct: 'causing', wrong: ['caused'], grammarType: '분사', explanation: '부대상 causing', koCorrect: '일으키며' },
    { sentenceIdx: 8, correct: 'argue', wrong: ['argues'], grammarType: '수일치', explanation: 'Critics → argue', koCorrect: '주장한다' },
    { sentenceIdx: 8, correct: 'give', wrong: ['giving'], grammarType: '부정사', explanation: 'should give up — 원형', koCorrect: '포기해야' },
    { sentenceIdx: 8, correct: 'employ', wrong: ['employing'], grammarType: '부정사', explanation: 'and employ — 원형 병렬', koCorrect: '사용해야' },
  ],
  [`${TEXTBOOK} 31번`]: [
    { sentenceIdx: 0, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: "it's uncertainty that makes — 강조구문", koCorrect: '느끼게 한다' },
    { sentenceIdx: 0, correct: 'feel', wrong: ['feeling'], grammarType: '부정사', explanation: 'makes us feel — 원형', koCorrect: '느끼게' },
    { sentenceIdx: 1, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'events that shake', koCorrect: '흔드는' },
    { sentenceIdx: 1, correct: 'shake', wrong: ['shakes'], grammarType: '수일치', explanation: 'that → shake', koCorrect: '흔드는' },
    { sentenceIdx: 1, correct: 'attending', wrong: ['attend'], grammarType: '동명사', explanation: 'maybe + -ing 병렬', koCorrect: '참석하는' },
    { sentenceIdx: 1, correct: 'making', wrong: ['make'], grammarType: '동명사', explanation: 'making a presentation — 동명사', koCorrect: '하는' },
    { sentenceIdx: 1, correct: "you've", wrong: ["you'd"], grammarType: '시제', explanation: 'have never been — 현재완료', koCorrect: '가 본 적 없는' },
    { sentenceIdx: 2, correct: 'seems', wrong: ['seem'], grammarType: '수일치', explanation: 'time → seems', koCorrect: '보인다' },
    { sentenceIdx: 2, correct: 'slow', wrong: ['slowing'], grammarType: '부정사', explanation: 'seems to slow — 원형', koCorrect: '느려지는' },
    { sentenceIdx: 2, correct: 'feel', wrong: ['feels'], grammarType: '수일치', explanation: 'you → feel', koCorrect: '느낀다' },
    { sentenceIdx: 3, correct: 'holds', wrong: ['hold'], grammarType: '수일치', explanation: 'The same → holds true', koCorrect: '적용된다' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'the experience → is risky', koCorrect: '위험하면' },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Your senses → are sharper', koCorrect: '예리해진다' },
    { sentenceIdx: 5, correct: 'notice', wrong: ['notices'], grammarType: '수일치', explanation: 'You → notice', koCorrect: '알아차린다' },
    { sentenceIdx: 6, correct: 'called', wrong: ['calling'], grammarType: '분사', explanation: 'chemical ... called dopamine', koCorrect: '불리는' },
    { sentenceIdx: 6, correct: 'get', wrong: ['gets'], grammarType: '수일치', explanation: 'you → get', koCorrect: '얻는다' },
    { sentenceIdx: 7, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Good news ... and gifts → are', koCorrect: '즐겁다' },
    { sentenceIdx: 7, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'if they → are surprises', koCorrect: '이면' },
    { sentenceIdx: 8, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'the most popular ... shows and movies → are', koCorrect: '이다' },
    { sentenceIdx: 8, correct: 'with', wrong: ['have'], grammarType: '전치사', explanation: 'the ones with unexpected twists', koCorrect: '있는' },
  ],
  [`${TEXTBOOK} 32번`]: [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'A great strength → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'there are incentives', koCorrect: '있다' },
    { sentenceIdx: 0, correct: 'reveal', wrong: ['revealing'], grammarType: '부정사', explanation: 'to reveal — 원형', koCorrect: '드러내도록' },
    { sentenceIdx: 1, correct: 'stands', wrong: ['stand'], grammarType: '수일치', explanation: 'This → stands', koCorrect: '대조된다' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'it → is wise', koCorrect: '현명하다' },
    { sentenceIdx: 1, correct: 'let', wrong: ['letting'], grammarType: '부정사', explanation: 'not to let — 원형', koCorrect: '알게 하지' },
    { sentenceIdx: 1, correct: 'know', wrong: ['knowing'], grammarType: '부정사', explanation: 'let ... know — 원형', koCorrect: '알도록' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'preferences or ... capacities → are', koCorrect: '무엇인지' },
    { sentenceIdx: 2, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'market that clears', koCorrect: '청산되는' },
    { sentenceIdx: 2, correct: 'leaves', wrong: ['leave'], grammarType: '수일치', explanation: 'A ... market → leaves', koCorrect: '남기지' },
    { sentenceIdx: 3, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'If prices → are not sticky', koCorrect: '고정되지' },
    { sentenceIdx: 3, correct: 'assume', wrong: ['assumes'], grammarType: '수일치', explanation: 'many models → assume', koCorrect: '가정하듯' },
    { sentenceIdx: 3, correct: 'adapt', wrong: ['adapts'], grammarType: '수일치', explanation: 'individuals → adapt', koCorrect: '적응한다' },
    { sentenceIdx: 3, correct: 'change', wrong: ['changes'], grammarType: '수일치', explanation: 'preferences or the circumstances → change', koCorrect: '변할' },
    { sentenceIdx: 4, correct: 'stop', wrong: ['stops'], grammarType: '수일치', explanation: 'They → stop', koCorrect: '그만둔다' },
    { sentenceIdx: 4, correct: 'buying', wrong: ['buy'], grammarType: '동명사', explanation: 'stop + -ing', koCorrect: '사는 것을' },
    { sentenceIdx: 4, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'items that do not satisfy', koCorrect: '충족시키지' },
    { sentenceIdx: 4, correct: 'selling', wrong: ['sell'], grammarType: '동명사', explanation: 'stop selling — 동명사', koCorrect: '파는 것을' },
    { sentenceIdx: 4, correct: 'provide', wrong: ['provides'], grammarType: '수일치', explanation: 'that → do not provide', koCorrect: '제공하지' },
    { sentenceIdx: 5, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'If they → have', koCorrect: '있다면' },
    { sentenceIdx: 5, correct: 'falling', wrong: ['fall'], grammarType: '동명사', explanation: 'for example, + -ing', koCorrect: '빠지는' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'there is no demand', koCorrect: '없다는' },
    { sentenceIdx: 5, correct: 'reveal', wrong: ['reveals'], grammarType: '수일치', explanation: 'markets → reveal', koCorrect: '드러낸다' },
    { sentenceIdx: 5, correct: 'accept', wrong: ['accepting'], grammarType: '부정사', explanation: 'better accept — 원형', koCorrect: '받아들이는' },
  ],
  [`${TEXTBOOK} 33번`]: [
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'definitions → are constantly revised', koCorrect: '개정된다' },
    { sentenceIdx: 0, correct: 'revised', wrong: ['revising'], grammarType: '수동태', explanation: 'are revised — 과거분사', koCorrect: '개정되는' },
    { sentenceIdx: 0, correct: 'keep', wrong: ['keeping'], grammarType: '부정사', explanation: 'to keep up — 원형', koCorrect: '따라가도록' },
    { sentenceIdx: 1, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: '"addicts" → were people', koCorrect: '이었다' },
    { sentenceIdx: 1, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'people who were unable', koCorrect: '할 수 없었던' },
    { sentenceIdx: 1, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'who → were unable', koCorrect: '할 수 없었던' },
    { sentenceIdx: 1, correct: 'pay', wrong: ['paying'], grammarType: '부정사', explanation: 'unable to pay — 원형', koCorrect: '갚을' },
    { sentenceIdx: 1, correct: 'gave', wrong: ['give'], grammarType: '시제', explanation: '과거 gave', koCorrect: '바쳤다' },
    { sentenceIdx: 2, correct: 'came', wrong: ['comes'], grammarType: '시제', explanation: '과거 came to be', koCorrect: '되었다' },
    { sentenceIdx: 2, correct: 'associated', wrong: ['associating'], grammarType: '수동태', explanation: 'be associated with — 과거분사', koCorrect: '연관된' },
    { sentenceIdx: 2, correct: 'becomes', wrong: ['become'], grammarType: '수일치', explanation: 'one → becomes', koCorrect: '된다' },
    { sentenceIdx: 3, correct: 'referred', wrong: ['refers'], grammarType: '시제', explanation: '과거 referred', koCorrect: '가리켰다' },
    { sentenceIdx: 3, correct: 'being', wrong: ['be'], grammarType: '동명사', explanation: 'to being — 전치사 to + -ing', koCorrect: '되는' },
    { sentenceIdx: 3, correct: 'had', wrong: ['has'], grammarType: '시제', explanation: '과거 had nothing', koCorrect: '없었다' },
    { sentenceIdx: 3, correct: 'being', wrong: ['be'], grammarType: '동명사', explanation: 'with being married', koCorrect: '되는' },
    { sentenceIdx: 4, correct: 'owning', wrong: ['own'], grammarType: '동명사', explanation: '동명사 주어 owning', koCorrect: '소유하는 것이' },
    { sentenceIdx: 4, correct: 'made', wrong: ['make'], grammarType: '시제', explanation: '과거 made', koCorrect: '만들었다' },
    { sentenceIdx: 4, correct: "you'd", wrong: ["you'll"], grammarType: '시제', explanation: 'would find — 과거 시점', koCorrect: '찾을' },
    { sentenceIdx: 4, correct: 'came', wrong: ['comes'], grammarType: '시제', explanation: '과거 came to mean', koCorrect: '의미하게' },
    { sentenceIdx: 4, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'a male who has been wed', koCorrect: '한' },
    { sentenceIdx: 4, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'who → has been wed', koCorrect: '한' },
    { sentenceIdx: 5, correct: 'tried', wrong: ['tries'], grammarType: '시제', explanation: '과거 tried', koCorrect: '시도했다' },
    { sentenceIdx: 5, correct: 'blow', wrong: ['blowing'], grammarType: '부정사', explanation: 'tried to blow — 원형', koCorrect: '폭파하려고' },
    { sentenceIdx: 6, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'He → was captured', koCorrect: '붙잡혔다' },
    { sentenceIdx: 6, correct: 'captured', wrong: ['capturing'], grammarType: '수동태', explanation: 'was captured — 과거분사', koCorrect: '붙잡힌' },
    { sentenceIdx: 6, correct: 'put', wrong: ['putting'], grammarType: '수동태', explanation: 'was put to death', koCorrect: '처형된' },
    { sentenceIdx: 7, correct: 'burned', wrong: ['burn'], grammarType: '시제', explanation: '과거 burned', koCorrect: '태웠다' },
    { sentenceIdx: 7, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'effigy, which they nicknamed', koCorrect: '그것을' },
    { sentenceIdx: 8, correct: 'lost', wrong: ['loses'], grammarType: '시제', explanation: '과거 lost', koCorrect: '잃었다' },
    { sentenceIdx: 8, correct: 'named', wrong: ['naming'], grammarType: '분사', explanation: 'musical named — 과거분사', koCorrect: '라는' },
    { sentenceIdx: 8, correct: 'ran', wrong: ['runs'], grammarType: '시제', explanation: '과거 ran', koCorrect: '공연되었다' },
    { sentenceIdx: 9, correct: 'means', wrong: ['mean'], grammarType: '수일치', explanation: 'bad → means', koCorrect: '의미한다' },
    { sentenceIdx: 10, correct: 'could', wrong: ['can'], grammarType: '가정법', explanation: 'If you could transport — 가정법', koCorrect: '옮길 수' },
    { sentenceIdx: 10, correct: 'transport', wrong: ['transporting'], grammarType: '부정사', explanation: 'could transport — 원형', koCorrect: '옮길' },
    { sentenceIdx: 10, correct: "you'd", wrong: ["you'll"], grammarType: '가정법', explanation: "you'd find — 가정법", koCorrect: '발견할' },
    { sentenceIdx: 10, correct: 'confused', wrong: ['confusing'], grammarType: '형용사', explanation: 'find yourself confused', koCorrect: '혼란스러워' },
    { sentenceIdx: 10, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'language itself → is', koCorrect: '이다' },
  ],
  [`${TEXTBOOK} 34번`]: [
    { sentenceIdx: 0, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'The term → was introduced', koCorrect: '도입되었다' },
    { sentenceIdx: 0, correct: 'introduced', wrong: ['introducing'], grammarType: '수동태', explanation: 'was introduced — 과거분사', koCorrect: '도입된' },
    { sentenceIdx: 0, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'Barthes who observed', koCorrect: '관찰한' },
    { sentenceIdx: 0, correct: 'observed', wrong: ['observes'], grammarType: '시제', explanation: '과거 observed', koCorrect: '관찰했다' },
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'text → is often used', koCorrect: '사용된다' },
    { sentenceIdx: 0, correct: 'used', wrong: ['using'], grammarType: '수동태', explanation: 'is used — 과거분사', koCorrect: '사용되는' },
    { sentenceIdx: 0, correct: 'confine', wrong: ['confining'], grammarType: '부정사', explanation: 'to confine — 원형', koCorrect: '한정하기' },
    { sentenceIdx: 1, correct: 'could', wrong: ['can'], grammarType: '조동사', explanation: 'image could elicit — 가능성', koCorrect: '이끌어 낼' },
    { sentenceIdx: 1, correct: 'elicit', wrong: ['eliciting'], grammarType: '부정사', explanation: 'could elicit — 원형', koCorrect: '이끌어 낼' },
    { sentenceIdx: 1, correct: 'would', wrong: ['will'], grammarType: '조동사', explanation: 'text would point — 과거 시점', koCorrect: '향하게 할' },
    { sentenceIdx: 1, correct: 'point', wrong: ['pointing'], grammarType: '부정사', explanation: 'would point — 원형', koCorrect: '향하게' },
    { sentenceIdx: 2, correct: 'argues', wrong: ['argue'], grammarType: '수일치', explanation: 'Barthes → argues', koCorrect: '주장하듯' },
    { sentenceIdx: 2, correct: 'does', wrong: ['do'], grammarType: '수일치', explanation: 'the symbolic message → does not', koCorrect: '하지' },
    { sentenceIdx: 2, correct: 'guide', wrong: ['guiding'], grammarType: '부정사', explanation: 'does not guide — 원형', koCorrect: '안내하지' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The viewer → is not asked', koCorrect: '요청받지' },
    { sentenceIdx: 3, correct: 'asked', wrong: ['asking'], grammarType: '수동태', explanation: 'is asked — 과거분사', koCorrect: '요청받는' },
    { sentenceIdx: 3, correct: 'recognize', wrong: ['recognizing'], grammarType: '부정사', explanation: 'to recognize — 원형', koCorrect: '인식하도록' },
    { sentenceIdx: 3, correct: 'see', wrong: ['sees'], grammarType: '수일치', explanation: 'they → see', koCorrect: '보는' },
    { sentenceIdx: 3, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'to understand — 원형', koCorrect: '이해하도록' },
    { sentenceIdx: 3, correct: 'means', wrong: ['mean'], grammarType: '수일치', explanation: 'what it → means', koCorrect: '의미하는지' },
    { sentenceIdx: 4, correct: 'combining', wrong: ['combine'], grammarType: '동명사', explanation: 'By + -ing', koCorrect: '결합함으로써' },
    { sentenceIdx: 4, correct: 'produces', wrong: ['produce'], grammarType: '수일치', explanation: 'advertising → produces', koCorrect: '만들어 낸다' },
    { sentenceIdx: 4, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'meaning that is accurate', koCorrect: '인' },
    { sentenceIdx: 4, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'that → is accurate', koCorrect: '이다' },
    { sentenceIdx: 4, correct: 'adding', wrong: ['added'], grammarType: '분사', explanation: '부대상 adding', koCorrect: '더하며' },
    { sentenceIdx: 4, correct: 'eliminating', wrong: ['eliminated'], grammarType: '분사', explanation: 'and eliminating — 병렬', koCorrect: '제거하며' },
    { sentenceIdx: 5, correct: 'directs', wrong: ['direct'], grammarType: '수일치', explanation: 'The headline or tagline → directs', koCorrect: '이끈다' },
    { sentenceIdx: 5, correct: 'avoids', wrong: ['avoid'], grammarType: '수일치', explanation: 'the reader → avoids', koCorrect: '피하도록' },
    { sentenceIdx: 5, correct: 'receives', wrong: ['receive'], grammarType: '수일치', explanation: 'and receives — 병렬', koCorrect: '받도록' },
    { sentenceIdx: 6, correct: 'chosen', wrong: ['choosing'], grammarType: '분사', explanation: 'meaning chosen — 과거분사', koCorrect: '선택된' },
  ],
};

async function loadPassages(): Promise<KitPassageInput[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook: TEXTBOOK, source_key: { $in: KEYS } })
    .project({
      textbook: 1,
      chapter: 1,
      number: 1,
      source_key: 1,
      'content.original': 1,
      'content.sentences_en': 1,
      'content.sentences_ko': 1,
    })
    .toArray();
  const byKey = new Map(docs.map((d) => [String(d.source_key), d]));
  return KEYS.filter((k) => byKey.has(k)).map((k) => {
    const d = byKey.get(k)!;
    return passageFromDoc({
      _id: String(d._id),
      textbook: d.textbook as string,
      chapter: d.chapter as string,
      number: d.number as string,
      source_key: d.source_key as string,
      content: d.content as {
        original?: string;
        sentences_en?: unknown;
        sentences_ko?: unknown;
      },
    });
  });
}

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
  const short = sourceKey.replace(TEXTBOOK + ' ', '');
  const title = `${TEXTBOOK} ${short} 어법공략`;
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

async function loadDocsInOrder(keys: string[]): Promise<GrammarWorkbookFull[]> {
  const listed = await listGrammarWorkbooks({ textbook: TEXTBOOK, limit: 500 });
  const byKey = new Map(listed.map((r) => [r.sourceKey, r]));
  const docs: GrammarWorkbookFull[] = [];
  for (const k of keys) {
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
  const passages = await loadPassages();
  console.log('passages', passages.length);

  console.log('=== 1) 어법 G/H ===');
  for (const p of passages) {
    const raw = await db.collection('passages').findOne({ textbook: TEXTBOOK, source_key: p.sourceKey });
    if (!raw) {
      console.error('missing', p.sourceKey);
      continue;
    }
    const content = (raw as { content?: Parameters<typeof tokenizePassageFromContent>[0] }).content;
    const sents = tokenizePassageFromContent(content ?? null);
    const pts = POINTS_BY_KEY[p.sourceKey] ?? [];
    const r = await saveGrammarForPassage(String(raw._id), p.sourceKey, sents, pts);
    console.log(p.number, 'saved', r.id, `points=${r.points} G=${r.g}`, r.created ? 'created' : 'updated');
  }

  console.log('=== 2) 합본 + 지문별 ===');
  const kitEntries = await buildWorkbookKitEntries(passages, {
    types: ['grammar_either_or'],
    includeTranslation: true,
  });
  const usable = kitEntries.filter((e) => e.html);
  for (const e of kitEntries) console.log(e.fileName, e.questionCount, e.warning || 'ok');
  if (usable.length) {
    const zip = await renderHtmlEntriesToZip(
      usable.map((e) => ({ fileName: e.fileName, html: e.html })),
      { margin },
    );
    fs.writeFileSync(path.join(OUT_DIR, '어법_양자택일_지문별.zip'), zip);
    console.log('per-passage zip', zip.length);
  }

  const docs = await loadDocsInOrder(KEYS);
  const gBulk = buildBulkWorkbookHtml(docs, {
    modes: ['G'],
    includePoints: false,
    layout: 'back',
    title: `${TEXTBOOK} 어법 양자택일 합본`,
  });
  if (!gBulk) throw new Error('G 합본 실패');
  const gPdf = await renderHtmlToPdf(gBulk.html, { margin });
  fs.writeFileSync(path.join(OUT_DIR, '어법_양자택일_전번호합본.pdf'), gPdf);
  console.log('G combined', gPdf.length);

  const zipName = `${TEXTBOOK}_워크북.zip`;
  const zipPath = path.join(path.dirname(OUT_DIR), zipName);
  fs.rmSync(zipPath, { force: true });
  execSync(`/usr/bin/zip -r ${JSON.stringify(zipPath)} ${JSON.stringify(ORDER)} -x "*.DS_Store"`, {
    cwd: path.dirname(OUT_DIR),
    stdio: 'inherit',
  });
  console.log('DONE', OUT_DIR, zipPath, fs.statSync(zipPath).size);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
