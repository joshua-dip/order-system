/**
 * MW-20260922-001 — 26년 9월 고2 영어모의고사 31~40번 어법 양자택일.
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

const TEXTBOOK = '26년 9월 고2 영어모의고사';
const NUMS = ['31', '32', '33', '34', '35', '36', '37', '38', '39', '40'];
const KEYS = NUMS.map((n) => `${TEXTBOOK} ${n}번`);
const ORDER = 'MW-20260922-001';
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
  [`${TEXTBOOK} 31번`]: [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Human geography → is', koCorrect: '되어 가고' },
    { sentenceIdx: 0, correct: 'becoming', wrong: ['become'], grammarType: '시제', explanation: 'is becoming — 현재진행', koCorrect: '되어 가는' },
    { sentenceIdx: 1, correct: 'find', wrong: ['finds'], grammarType: '수일치', explanation: 'people → find', koCorrect: '발견하면' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'we → are experiencing', koCorrect: '경험하고' },
    { sentenceIdx: 1, correct: 'transitions', wrong: ['transition'], grammarType: '수일치', explanation: 'matter → transitions', koCorrect: '전이할' },
    { sentenceIdx: 2, correct: 'might', wrong: ['must'], grammarType: '조동사', explanation: '약한 추측 might even say', koCorrect: '말할지도' },
    { sentenceIdx: 2, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'humans → are becoming', koCorrect: '되어 가고' },
    { sentenceIdx: 3, correct: 'would', wrong: ['will'], grammarType: '조동사', explanation: 'It would be nice — 가정·소망', koCorrect: '좋을 것이다' },
    { sentenceIdx: 3, correct: 'return', wrong: ['returning'], grammarType: '부정사', explanation: 'to return — 원형', koCorrect: '돌아가는' },
    { sentenceIdx: 4, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'the complexity → makes', koCorrect: '만든다' },
    { sentenceIdx: 4, correct: 'settle', wrong: ['settling'], grammarType: '부정사', explanation: 'difficult to settle — 원형', koCorrect: '정착하는' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'nomads and billionaires ... as well as workers → are', koCorrect: '이다' },
  ],
  [`${TEXTBOOK} 32번`]: [
    { sentenceIdx: 0, correct: 'encourages', wrong: ['encourage'], grammarType: '수일치', explanation: 'the most fundamental one → encourages', koCorrect: '장려한다' },
    { sentenceIdx: 0, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'to understand — 원형', koCorrect: '이해하기' },
    { sentenceIdx: 0, correct: 'predict', wrong: ['predicting'], grammarType: '부정사', explanation: 'to predict — 원형', koCorrect: '예측하기' },
    { sentenceIdx: 1, correct: 'prefer', wrong: ['prefers'], grammarType: '수일치', explanation: 'people → prefer', koCorrect: '선호한다' },
    { sentenceIdx: 1, correct: 'develop', wrong: ['developing'], grammarType: '부정사', explanation: 'prefer to develop — 원형', koCorrect: '발전시키는' },
    { sentenceIdx: 1, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'meanings that are shared', koCorrect: '공유되는' },
    { sentenceIdx: 2, correct: 'accept', wrong: ['accepts'], grammarType: '수일치', explanation: 'more people → accept', koCorrect: '수락하면' },
    { sentenceIdx: 2, correct: 'expects', wrong: ['expect'], grammarType: '수일치', explanation: 'a college → expects', koCorrect: '예상하는' },
    { sentenceIdx: 2, correct: 'living', wrong: ['live'], grammarType: '동명사', explanation: 'end up + -ing', koCorrect: '살게' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'It → is easy', koCorrect: '쉽다' },
    { sentenceIdx: 3, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'easy to understand — 원형', koCorrect: '이해하는' },
    { sentenceIdx: 3, correct: 'living', wrong: ['live'], grammarType: '동명사', explanation: 'why living ... is — 동명사 주어', koCorrect: '사는 것이' },
    { sentenceIdx: 5, correct: 'get', wrong: ['gets'], grammarType: '수일치', explanation: 'students → get', koCorrect: '얻는다' },
    { sentenceIdx: 6, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'living ... is problematic', koCorrect: '문제가 있다' },
    { sentenceIdx: 6, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'the student residents → are not', koCorrect: '아니다' },
    { sentenceIdx: 6, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'people who will be', koCorrect: '될' },
    { sentenceIdx: 8, correct: 'lack', wrong: ['lacks'], grammarType: '수일치', explanation: 'People → lack', koCorrect: '결여한다' },
    { sentenceIdx: 8, correct: 'developed', wrong: ['developing'], grammarType: '분사', explanation: 'normally developed from — 과거분사', koCorrect: '발전된' },
  ],
  [`${TEXTBOOK} 33번`]: [
    { sentenceIdx: 0, correct: 'agree', wrong: ['agrees'], grammarType: '수일치', explanation: 'Psychological theories → agree', koCorrect: '동의한다' },
    { sentenceIdx: 0, correct: 'grieving', wrong: ['grieve'], grammarType: '동명사', explanation: 'of + -ing', koCorrect: '슬퍼하는' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Grief → is', koCorrect: '이다' },
    { sentenceIdx: 1, correct: 'essential', wrong: ['essentially'], grammarType: '품사', explanation: '보어 형용사 essential', koCorrect: '필수적인' },
    { sentenceIdx: 2, correct: 'supports', wrong: ['support'], grammarType: '수일치', explanation: 'it → supports', koCorrect: '돕는다' },
    { sentenceIdx: 2, correct: 'face', wrong: ['facing'], grammarType: '부정사', explanation: 'supports us to face — 원형', koCorrect: '마주하도록' },
    { sentenceIdx: 2, correct: 'repair', wrong: ['repairing'], grammarType: '부정사', explanation: 'to repair — 원형', koCorrect: '회복하도록' },
    { sentenceIdx: 3, correct: 'honours', wrong: ['honour'], grammarType: '수일치', explanation: 'Grief work → honours', koCorrect: '기린다' },
    { sentenceIdx: 3, correct: 'setting', wrong: ['set'], grammarType: '동명사', explanation: 'while + -ing', koCorrect: '마련하면서' },
    { sentenceIdx: 4, correct: 'describes', wrong: ['describe'], grammarType: '수일치', explanation: 'Fran Weller → describes', koCorrect: '묘사한다' },
    { sentenceIdx: 4, correct: 'rooted', wrong: ['rooting'], grammarType: '분사', explanation: 'rooted in — 과거분사', koCorrect: '뿌리내린' },
    { sentenceIdx: 4, correct: 'requires', wrong: ['require'], grammarType: '수일치', explanation: 'that → requires', koCorrect: '요구하는' },
    { sentenceIdx: 5, correct: 'grieve', wrong: ['grieves'], grammarType: '수일치', explanation: 'we → grieve', koCorrect: '슬퍼할' },
    { sentenceIdx: 5, correct: 'clears', wrong: ['clear'], grammarType: '수일치', explanation: 'it → clears', koCorrect: '연다' },
    { sentenceIdx: 6, correct: 'build', wrong: ['builds'], grammarType: '수일치', explanation: 'this → may build', koCorrect: '쌓을' },
    { sentenceIdx: 6, correct: 'make', wrong: ['making'], grammarType: '부정사', explanation: 'to make good — 원형', koCorrect: '좋게 만드는' },
    { sentenceIdx: 6, correct: 'repairing', wrong: ['repair'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '고침으로써' },
    { sentenceIdx: 7, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'Grief → can make', koCorrect: '만들' },
    { sentenceIdx: 7, correct: 'act', wrong: ['acting'], grammarType: '부정사', explanation: 'motivated to act — 원형', koCorrect: '행동하도록' },
  ],
  [`${TEXTBOOK} 34번`]: [
    { sentenceIdx: 0, correct: 'focus', wrong: ['focuses'], grammarType: '수일치', explanation: 'we → focus', koCorrect: '집중하면' },
    { sentenceIdx: 0, correct: 'miss', wrong: ['misses'], grammarType: '수일치', explanation: 'we → miss', koCorrect: '놓친다' },
    { sentenceIdx: 0, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'changes that accumulate', koCorrect: '축적되는' },
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'that ... are not apparent', koCorrect: '드러나지' },
    { sentenceIdx: 1, correct: 'notice', wrong: ['notices'], grammarType: '수일치', explanation: 'Most of us → notice', koCorrect: '알아차린다' },
    { sentenceIdx: 1, correct: 'missing', wrong: ['miss'], grammarType: '동명사', explanation: 'while + -ing', koCorrect: '놓치면서' },
    { sentenceIdx: 3, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'It → was introduced', koCorrect: '도입되었다' },
    { sentenceIdx: 3, correct: 'introduced', wrong: ['introducing'], grammarType: '수동태', explanation: 'was introduced — 과거분사', koCorrect: '도입된' },
    { sentenceIdx: 3, correct: 'revolutionized', wrong: ['revolutionizes'], grammarType: '시제', explanation: '과거 revolutionized', koCorrect: '혁신했다' },
    { sentenceIdx: 4, correct: 'spent', wrong: ['spends'], grammarType: '시제', explanation: '과거 spent', koCorrect: '보냈다' },
    { sentenceIdx: 4, correct: 'fixing', wrong: ['fix'], grammarType: '동명사', explanation: 'spent ... + -ing', koCorrect: '준비하며' },
    { sentenceIdx: 5, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'it → was possible', koCorrect: '가능했다' },
    { sentenceIdx: 5, correct: 'prepare', wrong: ['preparing'], grammarType: '부정사', explanation: 'possible to prepare — 원형', koCorrect: '준비하는' },
    { sentenceIdx: 5, correct: 'tended', wrong: ['tend'], grammarType: '시제', explanation: '과거 tended', koCorrect: '경향이 있었다' },
    { sentenceIdx: 6, correct: 'made', wrong: ['make'], grammarType: '시제', explanation: '과거 made', koCorrect: '만들었다' },
    { sentenceIdx: 6, correct: 'overlook', wrong: ['overlooking'], grammarType: '부정사', explanation: 'easy to overlook — 원형', koCorrect: '간과하는' },
    { sentenceIdx: 6, correct: 'having', wrong: ['have'], grammarType: '동명사', explanation: 'of no longer having — 동명사', koCorrect: '갖는' },
    { sentenceIdx: 7, correct: 'went', wrong: ['goes'], grammarType: '시제', explanation: '과거 went on', koCorrect: '지나감에' },
    { sentenceIdx: 7, correct: 'sat', wrong: ['sit'], grammarType: '시제', explanation: '과거 sat down', koCorrect: '앉았다' },
    { sentenceIdx: 8, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'Meals that took', koCorrect: '걸린' },
    { sentenceIdx: 8, correct: 'became', wrong: ['become'], grammarType: '시제', explanation: '과거 became', koCorrect: '되었다' },
    { sentenceIdx: 9, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'The effects → were not anticipated', koCorrect: '예상되지' },
    { sentenceIdx: 9, correct: 'would', wrong: ['will'], grammarType: '가정법', explanation: 'would have been — 가정법 과거완료', koCorrect: '했을 것이다' },
  ],
  [`${TEXTBOOK} 35번`]: [
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Digital twins → are', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'using', wrong: ['used'], grammarType: '분사', explanation: 'using modeling — 현재분사', koCorrect: '사용하여' },
    { sentenceIdx: 0, correct: 'create', wrong: ['creating'], grammarType: '부정사', explanation: 'to create — 원형', koCorrect: '만들기' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Digital twins → are not new', koCorrect: '아니다' },
    { sentenceIdx: 1, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'engineering teams → have used', koCorrect: '사용해 왔다' },
    { sentenceIdx: 2, correct: 'enable', wrong: ['enables'], grammarType: '수일치', explanation: 'networks and ... availability → enable', koCorrect: '가능하게 한다' },
    { sentenceIdx: 3, correct: 'collect', wrong: ['collects'], grammarType: '수일치', explanation: 'sensors → collect', koCorrect: '수집하면' },
    { sentenceIdx: 3, correct: 'used', wrong: ['using'], grammarType: '수동태', explanation: 'can be used — 과거분사', koCorrect: '사용될' },
    { sentenceIdx: 3, correct: 'update', wrong: ['updating'], grammarType: '부정사', explanation: 'to continuously update — 원형', koCorrect: '갱신하기' },
    { sentenceIdx: 4, correct: 'becomes', wrong: ['become'], grammarType: '수일치', explanation: 'The digital twin → becomes', koCorrect: '된다' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'digital twins → are becoming', koCorrect: '되어 가고' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'when the assets → are very valuable', koCorrect: '가치 있을' },
    { sentenceIdx: 5, correct: 'would', wrong: ['will'], grammarType: '가정법', explanation: 'downtime would be — 가정', koCorrect: '일 것이다' },
  ],
  [`${TEXTBOOK} 36번`]: [
    { sentenceIdx: 0, correct: 'select', wrong: ['selecting'], grammarType: '부정사', explanation: 'ability to select — 원형', koCorrect: '선택하는' },
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The ability → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'measured', wrong: ['measuring'], grammarType: '분사', explanation: 'measured as — 과거분사', koCorrect: '측정되는' },
    { sentenceIdx: 1, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'Many studies → have shown', koCorrect: '보여 주었다' },
    { sentenceIdx: 1, correct: 'do', wrong: ['does'], grammarType: '수일치', explanation: 'not only do animals have — 도치', koCorrect: '가질' },
    { sentenceIdx: 1, correct: 'seek', wrong: ['seeking'], grammarType: '부정사', explanation: 'ability to seek — 원형', koCorrect: '찾는' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'they → are able', koCorrect: '할 수 있다' },
    { sentenceIdx: 1, correct: 'anticipate', wrong: ['anticipating'], grammarType: '부정사', explanation: 'able to anticipate — 원형', koCorrect: '예상하는' },
    { sentenceIdx: 1, correct: 'serve', wrong: ['serves'], grammarType: '수일치', explanation: 'a setting → will serve', koCorrect: '충족시킬' },
    { sentenceIdx: 2, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'songbird that nests', koCorrect: '둥지를 트는' },
    { sentenceIdx: 2, correct: 'establishes', wrong: ['establish'], grammarType: '수일치', explanation: 'the ... warbler → establishes', koCorrect: '설정한다' },
    { sentenceIdx: 2, correct: 'offer', wrong: ['offers'], grammarType: '수일치', explanation: 'these trees → offer', koCorrect: '제공하더라도' },
    { sentenceIdx: 3, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'when nests are built', koCorrect: '지어지고' },
    { sentenceIdx: 3, correct: 'need', wrong: ['needs'], grammarType: '수일치', explanation: 'baby birds → need', koCorrect: '필요로 할' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'it is the red spruce forest', koCorrect: '이다' },
    { sentenceIdx: 3, correct: 'offers', wrong: ['offer'], grammarType: '수일치', explanation: 'that → offers', koCorrect: '제공하는' },
    { sentenceIdx: 4, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'the warbler → has been guided', koCorrect: '인도되어' },
    { sentenceIdx: 4, correct: 'guided', wrong: ['guiding'], grammarType: '수동태', explanation: 'has been guided — 과거분사', koCorrect: '인도된' },
    { sentenceIdx: 4, correct: 'settle', wrong: ['settling'], grammarType: '부정사', explanation: 'to settle — 원형', koCorrect: '정착하도록' },
    { sentenceIdx: 4, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'locations that will suit', koCorrect: '맞는' },
  ],
  [`${TEXTBOOK} 37번`]: [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Language → is', koCorrect: '이다' },
    { sentenceIdx: 1, correct: 'do', wrong: ['does'], grammarType: '수일치', explanation: 'children → do not learn', koCorrect: '배우지' },
    { sentenceIdx: 1, correct: 'learn', wrong: ['learns'], grammarType: '수일치', explanation: 'they → learn', koCorrect: '배운다' },
    { sentenceIdx: 1, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'patterns ... that enable', koCorrect: '가능하게 하는' },
    { sentenceIdx: 1, correct: 'enable', wrong: ['enables'], grammarType: '수일치', explanation: 'patterns and styles → enable', koCorrect: '가능하게 한다' },
    { sentenceIdx: 1, correct: 'function', wrong: ['functioning'], grammarType: '부정사', explanation: 'enable them to function — 원형', koCorrect: '기능하도록' },
    { sentenceIdx: 2, correct: 'develop', wrong: ['develops'], grammarType: '수일치', explanation: 'They → develop', koCorrect: '발전시킨다' },
    { sentenceIdx: 2, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'style that is ... direct', koCorrect: '인' },
    { sentenceIdx: 3, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Examples ... are', koCorrect: '이다' },
    { sentenceIdx: 3, correct: 'linked', wrong: ['linking'], grammarType: '분사', explanation: 'words linked with — 과거분사', koCorrect: '연결된' },
    { sentenceIdx: 4, correct: 'require', wrong: ['requires'], grammarType: '수일치', explanation: 'assumptions → require', koCorrect: '요구한다' },
    { sentenceIdx: 4, correct: 'limit', wrong: ['limiting'], grammarType: '부정사', explanation: 'require that ... limit — 원형(가정법)', koCorrect: '제한하도록' },
    { sentenceIdx: 4, correct: 'using', wrong: ['use'], grammarType: '분사', explanation: '부대상 using', koCorrect: '사용하며' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The English language → is', koCorrect: '이다' },
    { sentenceIdx: 5, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'the only language ... that spells', koCorrect: '표기하는' },
    { sentenceIdx: 5, correct: 'spells', wrong: ['spell'], grammarType: '수일치', explanation: 'that → spells', koCorrect: '표기하는' },
    { sentenceIdx: 6, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: '가능성 may reflect', koCorrect: '반영할지도' },
    { sentenceIdx: 6, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'the roots → are', koCorrect: '있다' },
    { sentenceIdx: 7, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'There is no Japanese equivalent', koCorrect: '없다' },
    { sentenceIdx: 8, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'Different words are used', koCorrect: '사용된다' },
    { sentenceIdx: 8, correct: 'refer', wrong: ['referring'], grammarType: '부정사', explanation: 'used to refer — 원형', koCorrect: '지칭하기' },
    { sentenceIdx: 8, correct: 'depending', wrong: ['depended'], grammarType: '분사', explanation: '부대상 depending', koCorrect: '따라' },
  ],
  [`${TEXTBOOK} 38번`]: [
    { sentenceIdx: 0, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'Environmental psychologists → make', koCorrect: '구분한다' },
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'how many people → are', koCorrect: '있는지' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'high density → is needed', koCorrect: '필요하다' },
    { sentenceIdx: 1, correct: 'needed', wrong: ['needing'], grammarType: '수동태', explanation: 'is needed — 과거분사', koCorrect: '필요한' },
    { sentenceIdx: 1, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'crowding, which makes', koCorrect: '그것은' },
    { sentenceIdx: 1, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'which → makes', koCorrect: '만든다' },
    { sentenceIdx: 1, correct: 'experience', wrong: ['experiencing'], grammarType: '부정사', explanation: 'makes people experience — 원형', koCorrect: '경험하게' },
    { sentenceIdx: 2, correct: 'see', wrong: ['sees'], grammarType: '수일치', explanation: 'some psychologists → see', koCorrect: '본다' },
    { sentenceIdx: 2, correct: 'believe', wrong: ['believes'], grammarType: '수일치', explanation: 'and believe — 복수 주어 병렬', koCorrect: '믿는다' },
    { sentenceIdx: 2, correct: 'intensify', wrong: ['intensifies'], grammarType: '수일치', explanation: 'moods and behaviors → intensify', koCorrect: '강해진다' },
    { sentenceIdx: 2, correct: 'increases', wrong: ['increase'], grammarType: '수일치', explanation: 'density → increases', koCorrect: '증가함에' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'an individual → is looking', koCorrect: '기대하고' },
    { sentenceIdx: 3, correct: 'looking', wrong: ['looked'], grammarType: '시제', explanation: 'is looking forward — 현재진행', koCorrect: '기대하는' },
    { sentenceIdx: 3, correct: 'enhances', wrong: ['enhance'], grammarType: '수일치', explanation: 'the feeling → enhances', koCorrect: '높인다' },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'they → are dreading', koCorrect: '두려워하면' },
    { sentenceIdx: 4, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'crowding → will make', koCorrect: '만들' },
    { sentenceIdx: 5, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: '가능성 may accentuate', koCorrect: '강조할지도' },
    { sentenceIdx: 5, correct: 'turn', wrong: ['turns'], grammarType: '수일치', explanation: 'an aggressive group → may turn', koCorrect: '변할' },
    { sentenceIdx: 5, correct: 'rises', wrong: ['rise'], grammarType: '수일치', explanation: 'density → rises', koCorrect: '높아짐에' },
    { sentenceIdx: 6, correct: 'creating', wrong: ['create'], grammarType: '동명사', explanation: '동명사 주어 creating', koCorrect: '만드는 것은' },
    { sentenceIdx: 6, correct: 'help', wrong: ['helps'], grammarType: '수일치', explanation: 'creating ... may help', koCorrect: '도울' },
    { sentenceIdx: 6, correct: 'lift', wrong: ['lifting'], grammarType: '부정사', explanation: 'help to lift — 원형', koCorrect: '끌어올리는' },
  ],
  [`${TEXTBOOK} 39번`]: [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Exclusion → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'a state that is ignored', koCorrect: '무시되는' },
    { sentenceIdx: 0, correct: 'ignored', wrong: ['ignoring'], grammarType: '수동태', explanation: 'is ignored — 과거분사', koCorrect: '무시되는' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'it → is possible', koCorrect: '가능하다' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'precautions ... are not taken', koCorrect: '취해지지' },
    { sentenceIdx: 2, correct: 'react', wrong: ['reacts'], grammarType: '수일치', explanation: 'Individuals → react', koCorrect: '반응한다' },
    { sentenceIdx: 2, correct: 'trying', wrong: ['try'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '시도함으로써' },
    { sentenceIdx: 2, correct: 'strengthen', wrong: ['strengthening'], grammarType: '부정사', explanation: 'to strengthen — 원형', koCorrect: '강화하기' },
    { sentenceIdx: 2, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'needs, which are threatened', koCorrect: '위협받는' },
    { sentenceIdx: 3, correct: 'develop', wrong: ['develops'], grammarType: '수일치', explanation: 'Positive social behaviors → develop', koCorrect: '발전시킨다' },
    { sentenceIdx: 4, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'likelihood that individuals ... will', koCorrect: '것이라는' },
    { sentenceIdx: 4, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'individuals who try', koCorrect: '시도하는' },
    { sentenceIdx: 4, correct: 'adapt', wrong: ['adapting'], grammarType: '부정사', explanation: 'try to adapt — 원형', koCorrect: '적응하려고' },
    { sentenceIdx: 4, correct: 'decreases', wrong: ['decrease'], grammarType: '수일치', explanation: 'The likelihood → decreases', koCorrect: '감소한다' },
    { sentenceIdx: 5, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: '가능성 may be faced', koCorrect: '직면할지도' },
    { sentenceIdx: 5, correct: 'adapt', wrong: ['adapting'], grammarType: '부정사', explanation: 'cannot adapt — 원형', koCorrect: '적응할' },
    { sentenceIdx: 6, correct: 'grow', wrong: ['grows'], grammarType: '수일치', explanation: 'individuals → grow away', koCorrect: '멀어지면' },
    { sentenceIdx: 6, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: 'contribution ... may decrease', koCorrect: '감소할지도' },
    { sentenceIdx: 7, correct: 'is', wrong: ['are'], grammarType: '수동태', explanation: 'this situation is not avoided', koCorrect: '피하지' },
    { sentenceIdx: 7, correct: 'increases', wrong: ['increase'], grammarType: '수일치', explanation: 'exclusion → increases', koCorrect: '증가한다' },
    { sentenceIdx: 7, correct: 'affects', wrong: ['affect'], grammarType: '수일치', explanation: 'and ... affects — exclusion 주어', koCorrect: '영향을 미친다' },
    { sentenceIdx: 8, correct: 'need', wrong: ['needs'], grammarType: '수일치', explanation: 'Precautions → need', koCorrect: '필요하다' },
    { sentenceIdx: 8, correct: 'taken', wrong: ['taking'], grammarType: '수동태', explanation: 'to be taken — 과거분사', koCorrect: '취해져야' },
    { sentenceIdx: 8, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'exclusion, which is very important', koCorrect: '그것은' },
  ],
  [`${TEXTBOOK} 40번`]: [
    { sentenceIdx: 0, correct: 'retain', wrong: ['retains'], grammarType: '수일치', explanation: 'Our adult brains → retain', koCorrect: '유지한다' },
    { sentenceIdx: 0, correct: 'perpetuating', wrong: ['perpetuate'], grammarType: '동명사', explanation: 'preference for + -ing', koCorrect: '지속시키는' },
    { sentenceIdx: 1, correct: 'perceiving', wrong: ['perceive'], grammarType: '동명사', explanation: '동명사 주어 Simply perceiving', koCorrect: '인식하는 것은' },
    { sentenceIdx: 1, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'people who do good deeds', koCorrect: '하는' },
    { sentenceIdx: 1, correct: 'motivates', wrong: ['motivate'], grammarType: '수일치', explanation: 'perceiving ... motivates', koCorrect: '동기부여한다' },
    { sentenceIdx: 1, correct: 'do', wrong: ['doing'], grammarType: '부정사', explanation: 'motivates us to do — 원형', koCorrect: '하도록' },
    { sentenceIdx: 2, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'subjects who wrote', koCorrect: '적은' },
    { sentenceIdx: 2, correct: 'wrote', wrong: ['write'], grammarType: '시제', explanation: '과거 wrote', koCorrect: '적은' },
    { sentenceIdx: 2, correct: 'were', wrong: ['was'], grammarType: '수동태', explanation: 'and were then asked', koCorrect: '요청받은' },
    { sentenceIdx: 2, correct: 'asked', wrong: ['asking'], grammarType: '수동태', explanation: 'were asked — 과거분사', koCorrect: '요청받은' },
    { sentenceIdx: 2, correct: 'donate', wrong: ['donating'], grammarType: '부정사', explanation: 'asked to donate — 원형', koCorrect: '기부하도록' },
    { sentenceIdx: 2, correct: "they'd", wrong: ["they've"], grammarType: '시제', explanation: 'had made — 과거완료', koCorrect: '벌었던' },
    { sentenceIdx: 2, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'those who had been instructed', koCorrect: '지시받은' },
    { sentenceIdx: 3, correct: "who'd", wrong: ["who've"], grammarType: '시제', explanation: 'had taken — 과거완료', koCorrect: '공을 들인' },
    { sentenceIdx: 3, correct: 'describe', wrong: ['describing'], grammarType: '부정사', explanation: 'to describe — 원형', koCorrect: '묘사하기' },
    { sentenceIdx: 3, correct: "they'd", wrong: ["they've"], grammarType: '시제', explanation: 'had been nice — 과거완료', koCorrect: '친절했던' },
    { sentenceIdx: 3, correct: 'responded', wrong: ['respond'], grammarType: '시제', explanation: 'how people responded — 과거', koCorrect: '반응했는지' },
    { sentenceIdx: 3, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'subjects ... were likely', koCorrect: '경향이 있었다' },
    { sentenceIdx: 3, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'those who focused', koCorrect: '집중한' },
    { sentenceIdx: 4, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'people who seemed', koCorrect: '보인' },
    { sentenceIdx: 4, correct: 'seemed', wrong: ['seem'], grammarType: '시제', explanation: '과거 seemed', koCorrect: '보인' },
    { sentenceIdx: 4, correct: 'concerned', wrong: ['concerning'], grammarType: '형용사', explanation: 'seemed concerned about', koCorrect: '신경 쓰는' },
    { sentenceIdx: 4, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'people ... were less generous', koCorrect: '관대하지' },
    { sentenceIdx: 4, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'those who cared', koCorrect: '신경 쓴' },
    { sentenceIdx: 4, correct: 'doing', wrong: ['do'], grammarType: '동명사', explanation: 'about + -ing', koCorrect: '하는 것' },
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
  const title = `${TEXTBOOK} ${sourceKey.replace(TEXTBOOK + ' ', '')} 어법공략`;
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
    // Fix 40번 they'd/who'd — may not match tokens well; filter will warn
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
