/**
 * BW-20260922-001 — 영어II_YBM박준언 Lesson 2·3 본문 어법 양자택일.
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

const TEXTBOOK = '영어II_YBM박준언';
const CHAPTERS = [
  'Lesson 2. From Casual Buyers to Lasting Fans',
  'Lesson 3. Living With Viruses',
];
const ORDER = 'BW-20260922-001';
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
      const t = (tokens[i + j] ?? '').replace(/[.,!?;:"<>]+$/g, '').replace(/^[("<>]+/g, '');
      const w = want[j].replace(/[.,!?;:"<>]+$/g, '');
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
  'Lesson 2. From Casual Buyers to Lasting Fans 본문1': [
    { sentenceIdx: 1, correct: 'starts', wrong: ['start'], grammarType: '수일치', explanation: 'Jiyun → starts', koCorrect: '시작한다' },
    { sentenceIdx: 1, correct: 'logging', wrong: ['log'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '로그인하며' },
    { sentenceIdx: 2, correct: 'enjoys', wrong: ['enjoy'], grammarType: '수일치', explanation: 'She → enjoys', koCorrect: '즐긴다' },
    { sentenceIdx: 2, correct: 'listening', wrong: ['listen'], grammarType: '동명사', explanation: 'enjoy + -ing', koCorrect: '듣는 것을' },
    { sentenceIdx: 3, correct: 'receives', wrong: ['receive'], grammarType: '수일치', explanation: 'Jiyun → receives', koCorrect: '받는다' },
    { sentenceIdx: 3, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'service that provides', koCorrect: '공급하는' },
    { sentenceIdx: 4, correct: 'utilizes', wrong: ['utilize'], grammarType: '수일치', explanation: 'Jiyun → utilizes', koCorrect: '활용한다' },
    { sentenceIdx: 4, correct: 'expand', wrong: ['expanding'], grammarType: '부정사', explanation: 'to expand — 원형', koCorrect: '확장하기' },
    { sentenceIdx: 5, correct: 'watches', wrong: ['watch'], grammarType: '수일치', explanation: 'she → watches', koCorrect: '시청한다' },
    { sentenceIdx: 5, correct: 'review', wrong: ['reviewing'], grammarType: '부정사', explanation: 'to review — 원형', koCorrect: '복습하기' },
    { sentenceIdx: 6, correct: 'spend', wrong: ['spends'], grammarType: '수일치', explanation: 'Jiyun and her family → spend', koCorrect: '보낸다' },
    { sentenceIdx: 6, correct: 'watching', wrong: ['watched'], grammarType: '분사', explanation: 'spend time + -ing', koCorrect: '시청하며' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문2': [
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'the subscription economy → is', koCorrect: '이다' },
    { sentenceIdx: 1, correct: 'taking', wrong: ['taken'], grammarType: '분사', explanation: 'is taking part — 현재진행', koCorrect: '참여하고' },
    { sentenceIdx: 2, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The concept → is not new', koCorrect: '아니다' },
    { sentenceIdx: 2, correct: 'based', wrong: ['basing'], grammarType: '분사', explanation: 'models based on — 과거분사', koCorrect: '기반의' },
    { sentenceIdx: 3, correct: 'was', wrong: ['were'], grammarType: '수일치', explanation: 'it → was limited', koCorrect: '한정되었다' },
    { sentenceIdx: 4, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'these business models → have expanded', koCorrect: '확산되었다' },
    { sentenceIdx: 4, correct: 'including', wrong: ['included'], grammarType: '분사', explanation: 'including — 현재분사', koCorrect: '포함한' },
    { sentenceIdx: 5, correct: 'creating', wrong: ['create'], grammarType: '동명사', explanation: 'Instead of + -ing', koCorrect: '창출하는' },
    { sentenceIdx: 5, correct: 'sold', wrong: ['selling'], grammarType: '수동태', explanation: 'will be sold — 과거분사', koCorrect: '팔릴' },
    { sentenceIdx: 5, correct: 'providing', wrong: ['provide'], grammarType: '동명사', explanation: 'prioritize + -ing', koCorrect: '제공하는' },
    { sentenceIdx: 6, correct: 'pay', wrong: ['pays'], grammarType: '수일치', explanation: 'Customers → pay', koCorrect: '지불한다' },
    { sentenceIdx: 7, correct: 'brings', wrong: ['bring'], grammarType: '수일치', explanation: 'The subscription economy → brings', koCorrect: '가져다준다' },
    { sentenceIdx: 8, correct: 'using', wrong: ['use'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '사용해서' },
    { sentenceIdx: 9, correct: 'enjoy', wrong: ['enjoys'], grammarType: '수일치', explanation: 'they → can enjoy', koCorrect: '즐길' },
    { sentenceIdx: 11, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The rise → is closely connected', koCorrect: '연결되어' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문3-1': [
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The subscription economy → is', koCorrect: '관련이 있다' },
    { sentenceIdx: 1, correct: 'consume', wrong: ['consumes'], grammarType: '수일치', explanation: 'people → consume', koCorrect: '소비하는' },
    { sentenceIdx: 2, correct: 'prioritize', wrong: ['prioritizes'], grammarType: '수일치', explanation: 'people → prioritize', koCorrect: '우선시한다' },
    { sentenceIdx: 2, correct: 'owning', wrong: ['own'], grammarType: '동명사', explanation: 'over + -ing', koCorrect: '소유하는' },
    { sentenceIdx: 3, correct: 'makes', wrong: ['make'], grammarType: '수일치', explanation: 'This → makes', koCorrect: '만든다' },
    { sentenceIdx: 3, correct: 'offers', wrong: ['offer'], grammarType: '수일치', explanation: 'it → offers', koCorrect: '제공한다' },
    { sentenceIdx: 4, correct: 'subscribing', wrong: ['subscribe'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '구독함으로써' },
    { sentenceIdx: 4, correct: 'enjoy', wrong: ['enjoys'], grammarType: '수일치', explanation: 'consumers → can enjoy', koCorrect: '즐길' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Another example → is', koCorrect: '이다' },
    { sentenceIdx: 5, correct: 'where', wrong: ['which'], grammarType: '관계사', explanation: 'services, where consumers', koCorrect: '거기서' },
    { sentenceIdx: 6, correct: 'value', wrong: ['values'], grammarType: '수일치', explanation: 'consumers → value', koCorrect: '중시한다' },
    { sentenceIdx: 7, correct: 'offers', wrong: ['offer'], grammarType: '수일치', explanation: 'The subscription economy → offers', koCorrect: '제공한다' },
    { sentenceIdx: 7, correct: 'enabling', wrong: ['enabled'], grammarType: '분사', explanation: '부대상 enabling', koCorrect: '가능하게 하며' },
    { sentenceIdx: 8, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'This aspect → is', koCorrect: '인기 있다' },
    { sentenceIdx: 10, correct: 'stands', wrong: ['stand'], grammarType: '수일치', explanation: 'It → stands out', koCorrect: '돋보인다' },
    { sentenceIdx: 10, correct: 'analyzing', wrong: ['analyze'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '분석함으로써' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문3-2': [
    { sentenceIdx: 0, correct: 'appreciate', wrong: ['appreciates'], grammarType: '수일치', explanation: 'consumers → appreciate', koCorrect: '높이 산다' },
    { sentenceIdx: 1, correct: 'experience', wrong: ['experiences'], grammarType: '수일치', explanation: 'consumers → can experience', koCorrect: '경험할' },
    { sentenceIdx: 2, correct: 'adjust', wrong: ['adjusts'], grammarType: '수일치', explanation: 'they → can adjust', koCorrect: '조정할' },
    { sentenceIdx: 2, correct: 'choosing', wrong: ['choose'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '선택함으로써' },
    { sentenceIdx: 3, correct: 'enjoy', wrong: ['enjoys'], grammarType: '수일치', explanation: 'they → can either enjoy', koCorrect: '즐길' },
    { sentenceIdx: 3, correct: 'selecting', wrong: ['select'], grammarType: '동명사', explanation: 'by + -ing', koCorrect: '선택함으로써' },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'subscription services → are made', koCorrect: '만들어져' },
    { sentenceIdx: 4, correct: 'enhancing', wrong: ['enhanced'], grammarType: '분사', explanation: '부대상 enhancing', koCorrect: '향상시키며' },
    { sentenceIdx: 5, correct: 'receive', wrong: ['receives'], grammarType: '수일치', explanation: 'consumers → can receive', koCorrect: '받을' },
    { sentenceIdx: 6, correct: 'wish', wrong: ['wishes'], grammarType: '수일치', explanation: 'they → wish', koCorrect: '원하면' },
    { sentenceIdx: 6, correct: 'change', wrong: ['changing'], grammarType: '부정사', explanation: 'wish to change — 원형', koCorrect: '바꾸기를' },
    { sentenceIdx: 7, correct: 'desires', wrong: ['desire'], grammarType: '수일치', explanation: 'Whoever → desires', koCorrect: '원하는' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문4': [
    { sentenceIdx: 1, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'consumers → have been able', koCorrect: '할 수 있게' },
    { sentenceIdx: 1, correct: 'centered', wrong: ['centering'], grammarType: '분사', explanation: 'devices centered on — 과거분사', koCorrect: '중심으로 한' },
    { sentenceIdx: 2, correct: 'had', wrong: ['have'], grammarType: '시제', explanation: '과거 had no choice', koCorrect: '선택의 여지가 없었다' },
    { sentenceIdx: 2, correct: 'purchase', wrong: ['purchasing'], grammarType: '부정사', explanation: 'to purchase — 원형', koCorrect: '구매하는' },
    { sentenceIdx: 3, correct: 'wants', wrong: ['want'], grammarType: '수일치', explanation: 'whoever → wants', koCorrect: '원하는' },
    { sentenceIdx: 3, correct: 'access', wrong: ['accessing'], grammarType: '부정사', explanation: 'can access — 원형', koCorrect: '접속할' },
    { sentenceIdx: 4, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'these platforms → make', koCorrect: '만든다' },
    { sentenceIdx: 4, correct: 'offer', wrong: ['offering'], grammarType: '부정사', explanation: 'easy to offer — 원형', koCorrect: '제공하는' },
    { sentenceIdx: 5, correct: 'applying', wrong: ['apply'], grammarType: '동명사', explanation: 'By + -ing', koCorrect: '적용함으로써' },
    { sentenceIdx: 5, correct: 'identify', wrong: ['identifies'], grammarType: '수일치', explanation: 'companies → identify', koCorrect: '파악한다' },
    { sentenceIdx: 6, correct: 'appreciate', wrong: ['appreciates'], grammarType: '수일치', explanation: 'People → appreciate', koCorrect: '높이 산다' },
    { sentenceIdx: 6, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'customization, which enhances', koCorrect: '그것은' },
    { sentenceIdx: 7, correct: 'suggesting', wrong: ['suggested'], grammarType: '동명사', explanation: 'such as + -ing', koCorrect: '제안하는' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문5': [
    { sentenceIdx: 1, correct: 'offers', wrong: ['offer'], grammarType: '수일치', explanation: 'the subscription economy → offers', koCorrect: '제공한다' },
    { sentenceIdx: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'there are also some disadvantages', koCorrect: '있다' },
    { sentenceIdx: 2, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'One concern → is', koCorrect: '이다' },
    { sentenceIdx: 3, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'convenience and accessibility → make', koCorrect: '만든다' },
    { sentenceIdx: 3, correct: 'sign', wrong: ['signing'], grammarType: '부정사', explanation: 'easy to sign up — 원형', koCorrect: '가입하는' },
    { sentenceIdx: 4, correct: 'result', wrong: ['results'], grammarType: '수일치', explanation: 'This → can result', koCorrect: '초래할' },
    { sentenceIdx: 4, correct: 'using', wrong: ['use'], grammarType: '동명사', explanation: 'and using — 병렬 동명사', koCorrect: '사용하는' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'It → is crucial', koCorrect: '중요하다' },
    { sentenceIdx: 5, correct: 'subscribe', wrong: ['subscribing'], grammarType: '부정사', explanation: 'crucial to subscribe — 원형', koCorrect: '구독하는' },
    { sentenceIdx: 6, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Related ... is the financial burden', koCorrect: '이다' },
    { sentenceIdx: 6, correct: 'create', wrong: ['creates'], grammarType: '수일치', explanation: 'subscriptions → can create', koCorrect: '만들 수 있는' },
    { sentenceIdx: 7, correct: 'seem', wrong: ['seems'], grammarType: '수일치', explanation: 'cost ... may seem', koCorrect: '보일지라도' },
    { sentenceIdx: 7, correct: 'subscribing', wrong: ['subscribe'], grammarType: '동명사', explanation: '동명사 주어 subscribing', koCorrect: '구독하는 것은' },
    { sentenceIdx: 8, correct: 'consider', wrong: ['considering'], grammarType: '부정사', explanation: 'important to consider — 원형', koCorrect: '고려하는' },
    { sentenceIdx: 9, correct: 'reviewing', wrong: ['review'], grammarType: '동명사', explanation: '동명사 주어 Regularly reviewing', koCorrect: '검토하는 것은' },
  ],
  'Lesson 2. From Casual Buyers to Lasting Fans 본문6': [
    { sentenceIdx: 0, correct: 'contribute', wrong: ['contributes'], grammarType: '수일치', explanation: 'the subscription economy → can contribute', koCorrect: '기여할' },
    { sentenceIdx: 1, correct: 'increase', wrong: ['increases'], grammarType: '수일치', explanation: 'delivery ... can increase', koCorrect: '늘릴' },
    { sentenceIdx: 1, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'packaging, which harms', koCorrect: '그것은' },
    { sentenceIdx: 2, correct: 'Using', wrong: ['Use'], grammarType: '동명사', explanation: '동명사 주어 Using', koCorrect: '사용하는 것은' },
    { sentenceIdx: 2, correct: 'help', wrong: ['helps'], grammarType: '수일치', explanation: 'Using ... can help', koCorrect: '도울' },
    { sentenceIdx: 2, correct: 'reduce', wrong: ['reducing'], grammarType: '부정사', explanation: 'help reduce — 원형', koCorrect: '줄이는' },
    { sentenceIdx: 3, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'they → have become', koCorrect: '되어 있다' },
    { sentenceIdx: 3, correct: 'embedded', wrong: ['embedding'], grammarType: '수동태', explanation: 'have become embedded — 과거분사', koCorrect: '자리 잡은' },
    { sentenceIdx: 4, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'It → is expected', koCorrect: '예상된다' },
    { sentenceIdx: 4, correct: 'provided', wrong: ['providing'], grammarType: '수동태', explanation: 'will be provided — 과거분사', koCorrect: '제공될' },
    { sentenceIdx: 5, correct: 'need', wrong: ['needs'], grammarType: '수일치', explanation: 'We → need', koCorrect: '필요하다' },
    { sentenceIdx: 5, correct: 'who', wrong: ['which'], grammarType: '관계사', explanation: 'consumers who receive', koCorrect: '받는' },
  ],
  'Lesson 3. Living With Viruses 본문1': [
    { sentenceIdx: 1, correct: 'appears', wrong: ['appear'], grammarType: '수일치', explanation: 'It → appears', koCorrect: '보인다' },
    { sentenceIdx: 1, correct: 'exist', wrong: ['exists'], grammarType: '수일치', explanation: 'viruses → exist', koCorrect: '존재하는' },
    { sentenceIdx: 1, correct: 'bring', wrong: ['bringing'], grammarType: '부정사', explanation: 'solely to bring — 원형', koCorrect: '주기 위해' },
    { sentenceIdx: 2, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The 1918 influenza pandemic → is estimated', koCorrect: '추정된다' },
    { sentenceIdx: 2, correct: 'estimated', wrong: ['estimating'], grammarType: '수동태', explanation: 'is estimated to — 과거분사', koCorrect: '추정되는' },
    { sentenceIdx: 2, correct: 'killed', wrong: ['killing'], grammarType: '시제', explanation: 'to have killed — 완료부정사', koCorrect: '죽인' },
    { sentenceIdx: 3, correct: 'claimed', wrong: ['claims'], grammarType: '시제', explanation: '과거 claimed', koCorrect: '앗아갔다' },
    { sentenceIdx: 4, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'the recent COVID-19 pandemic → has taken', koCorrect: '앗아갔다' },
    { sentenceIdx: 4, correct: 'affecting', wrong: ['affected'], grammarType: '분사', explanation: '부대상 affecting', koCorrect: '영향을 미치며' },
  ],
  'Lesson 3. Living With Viruses 본문2': [
    { sentenceIdx: 0, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Outbreaks → are frequently linked', koCorrect: '연관되어' },
    { sentenceIdx: 0, correct: 'linked', wrong: ['linking'], grammarType: '수동태', explanation: 'are linked to — 과거분사', koCorrect: '연관된' },
    { sentenceIdx: 1, correct: 'allow', wrong: ['allows'], grammarType: '수일치', explanation: 'Such contacts → allow', koCorrect: '들어가게 한다' },
    { sentenceIdx: 1, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'bodies that have no prior immunity', koCorrect: '없는' },
    { sentenceIdx: 2, correct: 'prevented', wrong: ['prevent'], grammarType: '시제', explanation: '과거 prevented', koCorrect: '막았다' },
    { sentenceIdx: 2, correct: 'infecting', wrong: ['infect'], grammarType: '동명사', explanation: 'from + -ing', koCorrect: '감염시키는' },
    { sentenceIdx: 3, correct: 'has', wrong: ['have'], grammarType: '수일치', explanation: 'Industrialization → has destroyed', koCorrect: '파괴해 왔다' },
    { sentenceIdx: 3, correct: 'pushed', wrong: ['pushing'], grammarType: '시제', explanation: 'has pushed — 과거분사', koCorrect: '밀어냈다' },
    { sentenceIdx: 4, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'These changes → have resulted', koCorrect: '초래했다' },
    { sentenceIdx: 4, correct: 'meaning', wrong: ['meant'], grammarType: '분사', explanation: '부대상 meaning', koCorrect: '의미하며' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'This → is the primary reason', koCorrect: '이다' },
    { sentenceIdx: 5, correct: 'increase', wrong: ['increases'], grammarType: '수일치', explanation: 'pandemics → may increase', koCorrect: '늘어날' },
    { sentenceIdx: 6, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'is the virus — 주어 the virus', koCorrect: '인가' },
  ],
  'Lesson 3. Living With Viruses 본문3-1': [
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'What is less commonly known → is', koCorrect: '이다' },
    { sentenceIdx: 1, correct: 'play', wrong: ['plays'], grammarType: '수일치', explanation: 'viruses → play', koCorrect: '한다' },
    { sentenceIdx: 1, correct: 'supporting', wrong: ['support'], grammarType: '동명사', explanation: 'in + -ing', koCorrect: '지탱하는' },
    { sentenceIdx: 2, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'researchers → have only recently begun', koCorrect: '시작했다' },
    { sentenceIdx: 2, correct: 'investigating', wrong: ['investigate'], grammarType: '동명사', explanation: 'begun + -ing', koCorrect: '조사하기' },
    { sentenceIdx: 2, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'viruses that sustain us', koCorrect: '지탱하는' },
    { sentenceIdx: 3, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'scientists → have much more', koCorrect: '있다' },
    { sentenceIdx: 3, correct: 'learn', wrong: ['learning'], grammarType: '부정사', explanation: 'to learn — 원형', koCorrect: '배울' },
    { sentenceIdx: 4, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'What they do know → is', koCorrect: '이다' },
    { sentenceIdx: 4, correct: 'act', wrong: ['acts'], grammarType: '수일치', explanation: 'viruses → act', koCorrect: '작용한다' },
    { sentenceIdx: 5, correct: 'do', wrong: ['does'], grammarType: '수일치', explanation: 'viruses → do not have', koCorrect: '없다' },
    { sentenceIdx: 5, correct: 'steal', wrong: ['steals'], grammarType: '수일치', explanation: 'they → steal', koCorrect: '훔친다' },
    { sentenceIdx: 6, correct: 'use', wrong: ['uses'], grammarType: '수일치', explanation: 'Some types of viruses → use', koCorrect: '이용한다' },
    { sentenceIdx: 7, correct: 'continues', wrong: ['continue'], grammarType: '수일치', explanation: 'the virus → continues', koCorrect: '계속하면' },
    { sentenceIdx: 7, correct: 'multiply', wrong: ['multiplying'], grammarType: '부정사', explanation: 'continues to multiply — 원형', koCorrect: '증식하기' },
    { sentenceIdx: 8, correct: 'helps', wrong: ['help'], grammarType: '수일치', explanation: 'This whole process → helps', koCorrect: '돕는다' },
    { sentenceIdx: 8, correct: 'control', wrong: ['controlling'], grammarType: '부정사', explanation: 'helps control — 원형', koCorrect: '통제하는' },
  ],
  'Lesson 3. Living With Viruses 본문3-2': [
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The greater significance → is', koCorrect: '이다' },
    { sentenceIdx: 0, correct: 'infecting', wrong: ['infect'], grammarType: '동명사', explanation: 'of + -ing', koCorrect: '감염시키는' },
    { sentenceIdx: 0, correct: 'play', wrong: ['plays'], grammarType: '수일치', explanation: 'they → play', koCorrect: '한다' },
    { sentenceIdx: 0, correct: 'supplying', wrong: ['supply'], grammarType: '동명사', explanation: 'in + -ing', koCorrect: '공급하는' },
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'About half ... is produced', koCorrect: '생산된다' },
    { sentenceIdx: 1, correct: 'produced', wrong: ['producing'], grammarType: '수동태', explanation: 'is produced by — 과거분사', koCorrect: '생산되는' },
    { sentenceIdx: 2, correct: 'did', wrong: ['do'], grammarType: '가정법', explanation: 'If viruses did not — 가정법 과거', koCorrect: '않는다면' },
    { sentenceIdx: 2, correct: 'would', wrong: ['will'], grammarType: '가정법', explanation: 'there would be — 가정법', koCorrect: '없을 것이다' },
    { sentenceIdx: 3, correct: 'would', wrong: ['will'], grammarType: '가정법', explanation: 'would disappear — 가정법', koCorrect: '사라질 것이다' },
    { sentenceIdx: 4, correct: 'make', wrong: ['makes'], grammarType: '수일치', explanation: 'the lack of oxygen → would make', koCorrect: '만들' },
    { sentenceIdx: 4, correct: 'survive', wrong: ['surviving'], grammarType: '부정사', explanation: 'impossible to survive — 원형', koCorrect: '생존하는' },
    { sentenceIdx: 5, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'populations are also regulated', koCorrect: '조절된다' },
    { sentenceIdx: 6, correct: 'increases', wrong: ['increase'], grammarType: '수일치', explanation: 'a specific type → increases', koCorrect: '늘어나면' },
    { sentenceIdx: 6, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'viruses that infect', koCorrect: '감염시키는' },
    { sentenceIdx: 7, correct: 'creates', wrong: ['create'], grammarType: '수일치', explanation: 'This → creates', koCorrect: '만든다' },
    { sentenceIdx: 7, correct: 'flourish', wrong: ['flourishing'], grammarType: '부정사', explanation: 'to flourish — 원형', koCorrect: '번성하도록' },
    { sentenceIdx: 8, correct: 'Considering', wrong: ['Considered'], grammarType: '분사', explanation: '부대상 Considering', koCorrect: '고려하면' },
    { sentenceIdx: 8, correct: 'fulfill', wrong: ['fulfills'], grammarType: '수일치', explanation: 'viruses → fulfill', koCorrect: '수행한다' },
    { sentenceIdx: 9, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'We → have just started', koCorrect: '시작했다' },
    { sentenceIdx: 9, correct: 'understand', wrong: ['understanding'], grammarType: '부정사', explanation: 'to understand — 원형', koCorrect: '이해하기' },
  ],
  'Lesson 3. Living With Viruses 본문4': [
    { sentenceIdx: 1, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Another ... role → is', koCorrect: '이다' },
    { sentenceIdx: 2, correct: 'infects', wrong: ['infect'], grammarType: '수일치', explanation: 'a virus → infects', koCorrect: '감염시키면' },
    { sentenceIdx: 2, correct: 'may', wrong: ['must'], grammarType: '조동사', explanation: '가능성 may be passed', koCorrect: '전달될 수' },
    { sentenceIdx: 2, correct: 'passed', wrong: ['passing'], grammarType: '수동태', explanation: 'be passed down — 과거분사', koCorrect: '전달되는' },
    { sentenceIdx: 3, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The insertion → is', koCorrect: '이다' },
    { sentenceIdx: 4, correct: 'would', wrong: ['will'], grammarType: '가정법', explanation: 'would be impacted — 가정법', koCorrect: '영향을 받을 것이다' },
    { sentenceIdx: 5, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'One example → is', koCorrect: '이다' },
    { sentenceIdx: 6, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'A placenta → is', koCorrect: '이다' },
    { sentenceIdx: 6, correct: 'helps', wrong: ['help'], grammarType: '수일치', explanation: 'that → helps', koCorrect: '돕는' },
    { sentenceIdx: 6, correct: 'grow', wrong: ['growing'], grammarType: '부정사', explanation: 'helps the fetus grow — 원형', koCorrect: '자라도록' },
    { sentenceIdx: 7, correct: 'facilitates', wrong: ['facilitate'], grammarType: '수일치', explanation: 'It → facilitates', koCorrect: '촉진한다' },
    { sentenceIdx: 7, correct: 'protecting', wrong: ['protected'], grammarType: '동명사', explanation: 'while + -ing', koCorrect: '보호하면서' },
    { sentenceIdx: 8, correct: 'had', wrong: ['have'], grammarType: '시제', explanation: '과거 had to leave', koCorrect: '해야 했다' },
    { sentenceIdx: 8, correct: 'making', wrong: ['made'], grammarType: '분사', explanation: '부대상 making', koCorrect: '만들며' },
    { sentenceIdx: 9, correct: 'were', wrong: ['was'], grammarType: '수일치', explanation: 'females → were able', koCorrect: '할 수 있게' },
    { sentenceIdx: 9, correct: 'carry', wrong: ['carrying'], grammarType: '부정사', explanation: 'able to carry — 원형', koCorrect: '품을' },
    { sentenceIdx: 10, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'Viruses that infected', koCorrect: '감염시킨' },
    { sentenceIdx: 10, correct: 'infected', wrong: ['infecting'], grammarType: '시제', explanation: '과거 infected', koCorrect: '감염시킨' },
    { sentenceIdx: 10, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'Viruses ... have been reported', koCorrect: '보고되어' },
  ],
  'Lesson 3. Living With Viruses 본문5-1': [
    { sentenceIdx: 1, correct: 'continues', wrong: ['continue'], grammarType: '수일치', explanation: 'scientific knowledge → continues', koCorrect: '계속되면' },
    { sentenceIdx: 1, correct: 'expand', wrong: ['expanding'], grammarType: '부정사', explanation: 'continues to expand — 원형', koCorrect: '확장하기' },
    { sentenceIdx: 1, correct: 'utilizing', wrong: ['utilize'], grammarType: '동명사', explanation: 'for + -ing', koCorrect: '활용하기' },
    { sentenceIdx: 2, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'Of notable interest are the areas', koCorrect: '이다' },
    { sentenceIdx: 3, correct: 'can', wrong: ['must'], grammarType: '조동사', explanation: 'Genes can be compared', koCorrect: '비교될 수' },
    { sentenceIdx: 3, correct: 'compared', wrong: ['comparing'], grammarType: '수동태', explanation: 'be compared to — 과거분사', koCorrect: '비교되는' },
    { sentenceIdx: 3, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'guides that govern', koCorrect: '지배하는' },
    { sentenceIdx: 4, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'people → are born', koCorrect: '태어난다' },
    { sentenceIdx: 4, correct: 'which', wrong: ['what'], grammarType: '관계사', explanation: 'disorders, which can lead', koCorrect: '그것은' },
    { sentenceIdx: 5, correct: 'steps', wrong: ['step'], grammarType: '수일치', explanation: 'Gene therapy → steps in', koCorrect: '나선다' },
    { sentenceIdx: 5, correct: 'fix', wrong: ['fixing'], grammarType: '부정사', explanation: 'to fix — 원형', koCorrect: '고치기' },
    { sentenceIdx: 6, correct: 'lies', wrong: ['lie'], grammarType: '수일치', explanation: 'The essence → lies', koCorrect: '있다' },
    { sentenceIdx: 6, correct: 'delivering', wrong: ['deliver'], grammarType: '동명사', explanation: 'in + -ing', koCorrect: '전달하는' },
    { sentenceIdx: 6, correct: 'enabling', wrong: ['enabled'], grammarType: '분사', explanation: '부대상 enabling', koCorrect: '가능하게 하며' },
    { sentenceIdx: 7, correct: 'are', wrong: ['is'], grammarType: '수동태', explanation: 'viruses are used', koCorrect: '사용된다' },
    { sentenceIdx: 7, correct: 'modified', wrong: ['modifying'], grammarType: '분사', explanation: 'modified viruses — 과거분사', koCorrect: '변형된' },
    { sentenceIdx: 8, correct: 'function', wrong: ['functions'], grammarType: '수일치', explanation: 'cells → function', koCorrect: '기능하면' },
    { sentenceIdx: 8, correct: 'help', wrong: ['helping'], grammarType: '부정사', explanation: 'help the body — 원형', koCorrect: '돕는' },
  ],
  'Lesson 3. Living With Viruses 본문5-2': [
    { sentenceIdx: 0, correct: 'Using', wrong: ['Used'], grammarType: '동명사', explanation: '동명사 주어 Using', koCorrect: '사용하는 것은' },
    { sentenceIdx: 0, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'Using ... is based', koCorrect: '근거한다' },
    { sentenceIdx: 0, correct: 'utilizing', wrong: ['utilize'], grammarType: '동명사', explanation: 'of + -ing', koCorrect: '활용하는' },
    { sentenceIdx: 1, correct: 'can', wrong: ['must'], grammarType: '조동사', explanation: 'viruses can be manipulated', koCorrect: '조작될 수' },
    { sentenceIdx: 1, correct: 'manipulated', wrong: ['manipulating'], grammarType: '수동태', explanation: 'be manipulated — 과거분사', koCorrect: '조작되는' },
    { sentenceIdx: 1, correct: 'target', wrong: ['targeting'], grammarType: '부정사', explanation: 'to specifically target — 원형', koCorrect: '표적으로 삼아' },
    { sentenceIdx: 1, correct: 'leaving', wrong: ['left'], grammarType: '분사', explanation: '부대상 leaving', koCorrect: '남기며' },
    { sentenceIdx: 2, correct: 'is', wrong: ['are'], grammarType: '수일치', explanation: 'The use → is still', koCorrect: '있다' },
    { sentenceIdx: 3, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: 'many researchers → are involved', koCorrect: '관여하고' },
    { sentenceIdx: 3, correct: 'discovering', wrong: ['discover'], grammarType: '동명사', explanation: 'goal of + -ing', koCorrect: '발견하는' },
    { sentenceIdx: 3, correct: 'that', wrong: ['what'], grammarType: '관계사', explanation: 'diseases that were', koCorrect: '였던' },
    { sentenceIdx: 4, correct: 'have', wrong: ['has'], grammarType: '수일치', explanation: 'We → have yet to find', koCorrect: '아직' },
    { sentenceIdx: 4, correct: 'exist', wrong: ['exists'], grammarType: '수일치', explanation: 'virus types → exist', koCorrect: '존재하는지' },
    { sentenceIdx: 5, correct: 'learn', wrong: ['learns'], grammarType: '수일치', explanation: 'we → learn', koCorrect: '배울수록' },
    { sentenceIdx: 5, correct: 'will', wrong: ['would'], grammarType: '시제', explanation: '미래 will be', koCorrect: '될 것이다' },
    { sentenceIdx: 5, correct: 'use', wrong: ['using'], grammarType: '부정사', explanation: 'to use — 원형', koCorrect: '사용하기' },
    { sentenceIdx: 6, correct: 'will', wrong: ['would'], grammarType: '시제', explanation: 'will help — 미래', koCorrect: '도울 것이다' },
    { sentenceIdx: 6, correct: 'reach', wrong: ['reaching'], grammarType: '부정사', explanation: 'help us reach — 원형', koCorrect: '이르게' },
  ],
};

async function loadBodyPassages(): Promise<KitPassageInput[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook: TEXTBOOK, chapter: { $in: CHAPTERS } })
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
  return docs
    .filter((d) => String(d.number ?? '').startsWith('본문'))
    .sort((a, b) => {
      const ca = String(a.chapter);
      const cb = String(b.chapter);
      if (ca !== cb) return ca.localeCompare(cb, 'ko');
      return String(a.number).localeCompare(String(b.number), 'ko', { numeric: true });
    })
    .map((d) =>
      passageFromDoc({
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
      }),
    );
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
  const passages = await loadBodyPassages();
  const keys = passages.map((p) => p.sourceKey);
  console.log('passages', keys.length);

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

  console.log('=== 2) 키트(양자택일) + 전번호 합본 ===');
  const kitEntries = await buildWorkbookKitEntries(passages, {
    types: ['grammar_either_or'],
    includeTranslation: true,
  });
  const usable = kitEntries.filter((e) => e.html);
  for (const e of kitEntries) console.log(e.type, e.fileName, e.questionCount, e.warning || 'ok');
  if (usable.length) {
    const zip = await renderHtmlEntriesToZip(
      usable.map((e) => ({ fileName: e.fileName, html: e.html })),
      { margin },
    );
    fs.writeFileSync(path.join(OUT_DIR, '어법_양자택일_지문별.zip'), zip);
    console.log('per-passage zip', zip.length);
  }

  const docs = await loadDocsInOrder(keys);
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
