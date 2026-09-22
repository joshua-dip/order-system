/**
 * BW-20260921-001 주문 6지문 어법 G/H 재고 채우기 + Downloads PDF 묶음.
 * 실행: npx tsx scripts/_tmp-bw-kit-fulfill.ts
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import type { SentenceTokenized } from '@/lib/block-workbook-types';
import {
  syncPointsToModes,
  buildEitherOrHtml,
  buildCorrectionHtml,
  type GrammarPoint,
} from '@/lib/grammar-workbook-html';
import { saveGrammarWorkbook } from '@/lib/grammar-workbooks-store';
import { loadKitPassagesBySourceKeys } from '@/lib/workbook-kit/load-passages';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import { renderHtmlToPdf, renderHtmlEntriesToZip } from '@/lib/chromium-pdf';
import { buildLectureMaterialHtml } from '@/lib/lecture-material-html';
import {
  buildLessonMaterialHtml,
  type LessonMode,
} from '@/lib/lesson-material-html';

const TEXTBOOK = '리더스뱅크 Level 6(2019)';
const KEYS = [
  'Unit 07 19번',
  'Unit 07 20번',
  'Unit 07 21번',
  'Unit 08 22번',
  'Unit 08 23번',
  'Unit 08 24번',
];
const OUT_DIR = path.join(
  process.env.HOME || '.',
  'Downloads',
  'BW-20260921-001',
);

type Pt = {
  sentenceIdx: number;
  start: number;
  end: number;
  correct: string;
  wrong: string[];
  grammarType: string;
  explanation: string;
  koCorrect?: string;
  uses: ('G' | 'H')[];
  baseForm?: string;
};

function findTokenSpan(tokens: string[], needle: string): { start: number; end: number } | null {
  const want = needle.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      const t = (tokens[i + j] ?? '').replace(/[.,!?;:]$/, '');
      const w = want[j].replace(/[.,!?;:]$/, '');
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
    if (!sent) continue;
    let start = p.start;
    let end = p.end;
    const span = findTokenSpan(sent.tokens, p.correct);
    if (span) {
      start = span.start;
      end = span.end;
    }
    out.push({
      id: `S${p.sentenceIdx}-T${start}-${Math.random().toString(36).slice(2, 7)}`,
      sentenceIdx: p.sentenceIdx,
      startTokenIdx: start,
      endTokenIdx: end,
      correctForm: p.correct,
      wrongCandidates: p.wrong,
      grammarType: p.grammarType,
      explanation: p.explanation,
      koCorrect: p.koCorrect,
      uses: p.uses,
      baseForm: p.baseForm,
      hRole: 'error',
      jVariant: 'wrong',
    });
  }
  return out;
}

/** 주문 6지문용 어법 포인트 (G/H) — Pro 채팅 작성 분 */
const POINTS_BY_KEY: Record<string, Pt[]> = {
  'Unit 07 19번': [
    { sentenceIdx: 0, start: 1, end: 1, correct: 'are', wrong: ['is'], grammarType: '수일치', explanation: '주어 types(복수) → are', koCorrect: '있다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 5, end: 5, correct: 'which', wrong: ['that', 'what'], grammarType: '관계사', explanation: '비제한 관계절 which', koCorrect: '그것은', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 5, end: 5, correct: 'causes', wrong: ['cause', 'causing'], grammarType: '수일치', explanation: '동명사 Eating 주어 → causes', koCorrect: '일으킨다', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 13, end: 13, correct: 'damages', wrong: ['damage', 'damaging'], grammarType: '수일치', explanation: 'acidic rain → damages', koCorrect: '해를 입히는', uses: ['G', 'H'] },
    { sentenceIdx: 4, start: 3, end: 4, correct: 'build up', wrong: ['builds up', 'build'], grammarType: '동사', explanation: '복수 substances → build up', koCorrect: '쌓이면', uses: ['G', 'H'] },
    { sentenceIdx: 4, start: 10, end: 10, correct: 'cannot', wrong: ['can not', 'cant'], grammarType: '조동사', explanation: '격식체 부정 cannot', koCorrect: '수 없다', uses: ['G', 'H'] },
    { sentenceIdx: 6, start: 6, end: 6, correct: 'result', wrong: ['results', 'resulting'], grammarType: '수일치', explanation: 'diseases → result from', koCorrect: '생긴다', uses: ['G', 'H'] },
    { sentenceIdx: 7, start: 7, end: 7, correct: 'should', wrong: ['must', 'would'], grammarType: '조동사', explanation: '권고 should be', koCorrect: '되어야', uses: ['G', 'H'] },
    { sentenceIdx: 8, start: 3, end: 3, correct: 'keep', wrong: ['keeps', 'keeping'], grammarType: '동사', explanation: 'will keep you', koCorrect: '유지해 줄', uses: ['G', 'H'] },
    { sentenceIdx: 9, start: 5, end: 5, correct: 'dont', wrong: ['doesnt', 'didnt'], grammarType: '조동사', explanation: 'why do not you 권유', koCorrect: '어떠한가', uses: ['G', 'H'] },
  ],
  'Unit 07 20번': [
    { sentenceIdx: 0, start: 6, end: 6, correct: 'is', wrong: ['are', 'was'], grammarType: '수일치', explanation: 'A couple is getting', koCorrect: '늘어가고', uses: ['G', 'H'] },
    { sentenceIdx: 0, start: 14, end: 14, correct: 'advises', wrong: ['advise', 'advising'], grammarType: '수일치', explanation: 'doctor → advises', koCorrect: '충고한다', uses: ['G', 'H'] },
    { sentenceIdx: 0, start: 18, end: 18, correct: 'to', wrong: ['for', 'that'], grammarType: '부정사', explanation: 'advise them to write', koCorrect: '하라고', uses: ['G', 'H'] },
    { sentenceIdx: 1, start: 4, end: 4, correct: 'is', wrong: ['was', 'are'], grammarType: '시제', explanation: 'is about to', koCorrect: '가려고', uses: ['G', 'H'] },
    { sentenceIdx: 1, start: 16, end: 16, correct: 'asks', wrong: ['ask', 'asked'], grammarType: '수일치', explanation: 'his wife → asks', koCorrect: '부탁한다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 4, end: 4, correct: 'reminds', wrong: ['remind', 'reminded'], grammarType: '수일치', explanation: 'She reminds him', koCorrect: '상기시켜', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 0, end: 0, correct: 'I', wrong: ['Id', 'Ill'], grammarType: '조동사', explanation: 'I would like', koCorrect: '좋겠어요', uses: ['G', 'H'] },
    { sentenceIdx: 10, start: 6, end: 6, correct: 'loses', wrong: ['lose', 'lost'], grammarType: '수일치', explanation: 'he loses his temper', koCorrect: '화를 내며', uses: ['G', 'H'] },
    { sentenceIdx: 12, start: 4, end: 4, correct: 'returns', wrong: ['return', 'returned'], grammarType: '수일치', explanation: 'he returns', koCorrect: '돌아온다', uses: ['G', 'H'] },
    { sentenceIdx: 13, start: 2, end: 2, correct: 'stares', wrong: ['stare', 'staring'], grammarType: '수일치', explanation: 'His wife stares', koCorrect: '빤히 쳐다보며', uses: ['G', 'H'] },
  ],
  'Unit 07 21번': [
    { sentenceIdx: 0, start: 4, end: 4, correct: 'conducted', wrong: ['conducts', 'conducting'], grammarType: '시제', explanation: '과거 conducted', koCorrect: '실시했다', uses: ['G', 'H'] },
    { sentenceIdx: 1, start: 1, end: 1, correct: 'some', wrong: ['any', 'few'], grammarType: '한정사', explanation: '긍정문 some students', koCorrect: '일부', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 2, end: 2, correct: 'a', wrong: ['an', 'the'], grammarType: '관사', explanation: 'a computer program', koCorrect: '프로그램', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 6, end: 6, correct: 'got', wrong: ['get', 'gets'], grammarType: '시제', explanation: '과거 got more votes', koCorrect: '얻었다', uses: ['G', 'H'] },
    { sentenceIdx: 4, start: 8, end: 8, correct: 'came', wrong: ['come', 'comes'], grammarType: '시제', explanation: 'came up with', koCorrect: '고안해 냈다', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 2, end: 2, correct: 'is', wrong: ['are', 'was'], grammarType: '수일치', explanation: 'CAPTCHA is', koCorrect: '이다', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 12, end: 12, correct: 'that', wrong: ['which', 'what'], grammarType: '관계사', explanation: 'a kind of test that', koCorrect: '설계된', uses: ['G', 'H'] },
    { sentenceIdx: 7, start: 5, end: 5, correct: 'cant', wrong: ['couldnt', 'wont'], grammarType: '조동사', explanation: 'computers cannot', koCorrect: '식별할 수 없다', uses: ['G', 'H'] },
    { sentenceIdx: 8, start: 5, end: 5, correct: 'are', wrong: ['is', 'were'], grammarType: '수일치', explanation: 'Visitors are required', koCorrect: '해야 한다', uses: ['G', 'H'] },
    { sentenceIdx: 10, start: 7, end: 7, correct: 'continue', wrong: ['continues', 'continued'], grammarType: '수일치', explanation: 'its forms continue', koCorrect: '진화하고', uses: ['G', 'H'] },
  ],
  'Unit 08 22번': [
    { sentenceIdx: 0, start: 3, end: 3, correct: 'are', wrong: ['is', 'were'], grammarType: '수일치', explanation: 'magpies are smart', koCorrect: '똑똑한', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 2, end: 2, correct: 'was', wrong: ['were', 'is'], grammarType: '수동태', explanation: 'was conducted', koCorrect: '실시되었다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 5, end: 5, correct: 'to', wrong: ['for', 'of'], grammarType: '부정사', explanation: 'to test the memories', koCorrect: '위해', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 1, end: 1, correct: 'climbed', wrong: ['climbs', 'climbing'], grammarType: '시제', explanation: '과거 climbed up', koCorrect: '올라가서', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 12, end: 12, correct: 'was', wrong: ['were', 'is'], grammarType: '시제', explanation: 'was watching', koCorrect: '보고 있을 때', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 2, end: 2, correct: 'cried', wrong: ['cries', 'crying'], grammarType: '시제', explanation: '과거 cried', koCorrect: '울부짖었다', uses: ['G', 'H'] },
    { sentenceIdx: 6, start: 4, end: 4, correct: 'followed', wrong: ['follows', 'following'], grammarType: '시제', explanation: 'even followed him', koCorrect: '따라가면서', uses: ['G', 'H'] },
    { sentenceIdx: 8, start: 9, end: 9, correct: 'wearing', wrong: ['wore', 'worn'], grammarType: '분사', explanation: 'man wearing', koCorrect: '입은', uses: ['G', 'H'] },
    { sentenceIdx: 9, start: 3, end: 3, correct: 'showed', wrong: ['shows', 'showing'], grammarType: '시제', explanation: 'showed no reaction', koCorrect: '보이지 않았다', uses: ['G', 'H'] },
    { sentenceIdx: 10, start: 7, end: 7, correct: 'could', wrong: ['can', 'would'], grammarType: '조동사', explanation: 'could remember', koCorrect: '기억할 수 있었음', uses: ['G', 'H'] },
  ],
  'Unit 08 23번': [
    { sentenceIdx: 0, start: 2, end: 2, correct: 'can', wrong: ['could', 'will'], grammarType: '조동사', explanation: 'How can we make', koCorrect: '할 수 있을까', uses: ['G', 'H'] },
    { sentenceIdx: 1, start: 5, end: 5, correct: 'is', wrong: ['are', 'was'], grammarType: '수일치', explanation: 'One simple idea is', koCorrect: '것이다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 1, end: 1, correct: 'show', wrong: ['shows', 'showing'], grammarType: '수일치', explanation: 'Studies show', koCorrect: '따르면', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 7, end: 7, correct: 'were', wrong: ['was', 'are'], grammarType: '수동태', explanation: 'were paid', koCorrect: '받았다', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 9, end: 9, correct: 'to', wrong: ['for', 'that'], grammarType: '부정사', explanation: 'paid to do well', koCorrect: '칠 수 있도록', uses: ['G', 'H'] },
    { sentenceIdx: 4, start: 4, end: 4, correct: 'were', wrong: ['was', 'are'], grammarType: '수일치', explanation: 'scores were higher', koCorrect: '향상되었다', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 2, end: 2, correct: 'think', wrong: ['thinks', 'thinking'], grammarType: '수일치', explanation: 'Many parents think', koCorrect: '생각한다', uses: ['G', 'H'] },
    { sentenceIdx: 7, start: 2, end: 2, correct: 'are', wrong: ['is', 'were'], grammarType: '수일치', explanation: 'They are afraid', koCorrect: '우려한다', uses: ['G', 'H'] },
    { sentenceIdx: 9, start: 6, end: 6, correct: 'who', wrong: ['which', 'that'], grammarType: '관계사', explanation: 'people who get rewards', koCorrect: '받는', uses: ['G', 'H'] },
    { sentenceIdx: 10, start: 3, end: 3, correct: 'believe', wrong: ['believes', 'believing'], grammarType: '수일치', explanation: 'psychologists believe', koCorrect: '믿는다', uses: ['G', 'H'] },
  ],
  'Unit 08 24번': [
    { sentenceIdx: 0, start: 3, end: 3, correct: 'is', wrong: ['are', 'was'], grammarType: '수일치', explanation: 'music is more than', koCorrect: '이상의', uses: ['G', 'H'] },
    { sentenceIdx: 1, start: 2, end: 2, correct: 'can', wrong: ['could', 'may'], grammarType: '조동사', explanation: 'It can greatly affect', koCorrect: '끼칠 수 있다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 2, end: 2, correct: 'show', wrong: ['shows', 'showing'], grammarType: '수일치', explanation: 'MRI scans show', koCorrect: '보여 준다', uses: ['G', 'H'] },
    { sentenceIdx: 2, start: 8, end: 8, correct: 'becomes', wrong: ['become', 'becoming'], grammarType: '수일치', explanation: 'brain becomes active', koCorrect: '활발해지는', uses: ['G', 'H'] },
    { sentenceIdx: 3, start: 9, end: 9, correct: 'light', wrong: ['lights', 'lighting'], grammarType: '수일치', explanation: 'Activities light up', koCorrect: '불을 켠다', uses: ['G', 'H'] },
    { sentenceIdx: 5, start: 2, end: 2, correct: 'makes', wrong: ['make', 'making'], grammarType: '수일치', explanation: 'music makes many parts', koCorrect: '환하게 한다', uses: ['G', 'H'] },
    { sentenceIdx: 7, start: 8, end: 8, correct: 'flashes', wrong: ['flash', 'flashing'], grammarType: '수일치', explanation: 'brain flashes', koCorrect: '번쩍거린다', uses: ['G', 'H'] },
    { sentenceIdx: 8, start: 7, end: 7, correct: 'were', wrong: ['was', 'is'], grammarType: '가정법', explanation: 'as if were engaging', koCorrect: '참여하고 있는', uses: ['G', 'H'] },
    { sentenceIdx: 9, start: 0, end: 0, correct: 'Exercising', wrong: ['Exercise', 'Exercised'], grammarType: '동명사', explanation: '주어 동명사 Exercising', koCorrect: '운동을 하는 것은', uses: ['G', 'H'] },
    { sentenceIdx: 10, start: 8, end: 8, correct: 'makes', wrong: ['make', 'making'], grammarType: '수일치', explanation: 'listening makes your brain', koCorrect: '만들어 주며', uses: ['G', 'H'] },
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
  return { ...result, g: modeData.G.points.length, h: modeData.H.spans.length };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = await getDb('gomijoshua');

  console.log('=== 1) 어법 G/H 재고 ===');
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
    console.log(key, 'saved', r.id, `G=${r.g} H=${r.h}`, r.created ? 'created' : 'updated');
  }

  console.log('=== 2) 워크북키트 PDF (빈칸·낱말·어법) ===');
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
    console.log(e.type, e.questionCount, e.warning || 'ok', e.html ? `${e.html.length}b` : '');
  }
  if (usable.length) {
    const zip = await renderHtmlEntriesToZip(
      usable.map((e) => ({ fileName: e.fileName, html: e.html })),
      { margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } },
    );
    const zipPath = path.join(OUT_DIR, '워크북키트_빈칸_낱말_어법.zip');
    fs.writeFileSync(zipPath, zip);
    console.log('wrote', zipPath, zip.length);
  }

  console.log('=== 3) 강의용 · 수업용(한줄/영작/해석쓰기) PDF ===');
  const lecturePages: string[] = [];
  const lessonModes: LessonMode[] = ['lineByLine', 'writeEn', 'writeKo'];
  const lessonHtmlByMode: Record<string, string[]> = {
    lineByLine: [],
    writeEn: [],
    writeKo: [],
  };

  for (const p of passages) {
    const pairs = p.sentencesEn.map((en, i) => ({
      idx: i,
      en,
      ko: p.sentencesKo[i] ?? '',
    }));
    lecturePages.push(
      buildLectureMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        sentences: p.sentencesEn.map((text, idx) => ({ idx, text })),
        kicker: '강의용자료',
      }),
    );
    for (const mode of lessonModes) {
      lessonHtmlByMode[mode].push(
        buildLessonMaterialHtml({
          title: TEXTBOOK,
          chapter: p.chapter,
          number: p.number.replace(/번$/, ''),
          mode,
          sentences: pairs,
          kicker:
            mode === 'lineByLine' ? '한줄해석' : mode === 'writeEn' ? '영작하기' : '해석쓰기',
        }),
      );
    }
  }

  const wrapMulti = (parts: string[], title: string) => {
    const bodies = parts.map((html) => {
      const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      return `<section style="page-break-after:always">${m ? m[1] : html}</section>`;
    });
    const styles = parts
      .map((html) => {
        const sm = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        return sm ? sm[1] : '';
      })
      .join('\n');
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body>${bodies.join('\n')}</body></html>`;
  };

  const lecturePdf = await renderHtmlToPdf(wrapMulti(lecturePages, '강의용자료'), {
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
  });
  fs.writeFileSync(path.join(OUT_DIR, '강의용자료.pdf'), lecturePdf);
  console.log('강의용자료.pdf', lecturePdf.length);

  for (const mode of lessonModes) {
    const label =
      mode === 'lineByLine' ? '한줄해석' : mode === 'writeEn' ? '영작하기' : '해석쓰기';
    const pdf = await renderHtmlToPdf(wrapMulti(lessonHtmlByMode[mode], label), {
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    fs.writeFileSync(path.join(OUT_DIR, `${label}.pdf`), pdf);
    console.log(`${label}.pdf`, pdf.length);
  }

  console.log('DONE', OUT_DIR);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
