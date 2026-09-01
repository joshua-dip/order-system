/**
 * 분석지 초안 변환기 — 원문 문자열로 적은 초안을 단어 인덱스로 바꾼다.
 *
 * 인덱스를 손으로 세면 반드시 어긋난다(실제로 svoc·어법 43+42건을 사후 교정했다).
 * 그래서 초안에는 **원문 표현 그대로** 적고, 위치는 여기서 토큰을 맞춰 찾는다.
 * 못 찾으면 조용히 넘기지 않고 오류로 세운다 — 틀린 위치가 지면에 나가는 편이 더 나쁘다.
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import { getDb } from '@/lib/mongodb';

const n = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
const errs: string[] = [];

/** 문장 안에서 표현이 차지하는 단어 범위. occ 는 몇 번째 등장인지(1부터). */
function findRange(tokens: string[], phrase: string, occ = 1, ctx = ''): [number, number] | null {
  const want = n(phrase);
  const wantTok = want.split(' ');
  let seen = 0;
  for (let i = 0; i + wantTok.length <= tokens.length; i++) {
    if (n(tokens.slice(i, i + wantTok.length).join(' ')) === want) {
      if (++seen === occ) return [i, i + wantTok.length - 1];
    }
  }
  /* 구두점 차이는 흔하다 — 문장부호를 떼고 한 번 더 본다. */
  const strip = (s: string) => s.replace(/[.,;:!?"'’”()–—]/g, '');
  const w2 = strip(want).split(' ').filter(Boolean);
  seen = 0;
  for (let i = 0; i + w2.length <= tokens.length; i++) {
    if (strip(n(tokens.slice(i, i + w2.length).join(' '))) === strip(want)) {
      if (++seen === occ) return [i, i + w2.length - 1];
    }
  }
  errs.push(`${ctx} 표현을 못 찾음: "${phrase}"`);
  return null;
}

const COLOR: [RegExp, string, 'phrase' | 'clause'][] = [
  [/관계(절|사)/, '#22c55e', 'clause'],
  [/명사절/, '#3b82f6', 'clause'],
  [/부사절|부사 절/, '#f59e0b', 'clause'],
  [/절$|절 /, '#3b82f6', 'clause'],
  [/분사/, '#a855f7', 'phrase'],
  [/to ?부정사/, '#ef4444', 'phrase'],
  [/예시/, '#ec4899', 'phrase'],
  [/전치사구|구$/, '#0ea5e9', 'phrase'],
];
function styleFor(label: string): { color: string; type: 'phrase' | 'clause' } {
  for (const [re, color, type] of COLOR) if (re.test(label)) return { color, type };
  return { color: '#0ea5e9', type: 'phrase' };
}

interface Spec {
  passageId: string;
  topic?: number[];
  essay?: number[];
  chunks?: Record<string, string[]>;
  svoc?: Record<string, { S?: string; V?: string; O?: string; C?: string; Sn?: number; Vn?: number; On?: number; Cn?: number }>;
  phrases?: Record<string, { text: string; label: string; modifies?: string; occ?: number; depth?: number }[]>;
  tags?: { s: number; text: string; tag: string; cat: string; exp: string; occ?: number }[];
  points?: Record<string, { title: string; content: string }[]>;
  gwords?: Record<string, string[]>;
  cwords?: Record<string, string[]>;
  /** 신규 지문용 — 기존 분석이 없으면 물려받을 것이 없어 직접 준다. */
  comprehensive?: Record<string, string>;
  vocab?: {
    word: string; meaning: string; partOfSpeech?: string; cefr?: string;
    synonym?: string; antonym?: string; wordType?: string;
  }[];
}

/** "word" 또는 "word#2" → 문장 내 단어 인덱스 */
function wordIdx(tokens: string[], spec: string, ctx: string): number | null {
  const mm = /^(.*?)#(\d+)$/.exec(spec);
  const w = mm ? mm[1] : spec;
  const occ = mm ? Number(mm[2]) : 1;
  const r = findRange(tokens, w, occ, ctx);
  return r ? r[0] : null;
}

async function main() {
  const specPath = process.argv[2];
  const outPath = process.argv[3];
  const spec: Spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const db = await getDb('gomijoshua');
  const { ObjectId } = await import('mongodb');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(spec.passageId) });
  if (!p) throw new Error('지문 없음');
  const c = (p.content ?? {}) as Record<string, string[]>;
  const sentences = c.sentences_en ?? [];
  const koreanSentences = c.sentences_ko ?? [];
  const toks = sentences.map((s) => n(s).split(' '));

  /* 기존 저장분에서 종합분석·어휘를 물려받는다 (문장 분할과 무관한 지문 단위 정보). */
  const { passageAnalysisFileNameForPassageId } = await import('@/lib/passage-analyzer-types');
  const prev = await db.collection('passage_analyses')
    .findOne({ fileName: passageAnalysisFileNameForPassageId(spec.passageId) }) as Record<string, any> | null;
  const prevMain = prev?.passageStates?.main ?? {};

  /* 어휘 위치는 옛 인덱스라 새 문장에서 다시 찾는다. spec.vocab 이 오면 그것이 우선. */
  const vocabSource: Record<string, unknown>[] = spec.vocab?.length
    ? spec.vocab.map((v) => ({ wordType: 'word', ...v }))
    : (prevMain.vocabularyList ?? []);
  const vocabularyList = vocabSource.map((v: Record<string, unknown>) => {
    const word = String(v.word ?? '');
    const stem = word.replace(/\s+/g, ' ').trim();
    const positions: { sentence: number; position: number }[] = [];
    sentences.forEach((s, si) => {
      const t = n(s).split(' ');
      const r = (() => {
        const want = stem.toLowerCase().split(' ');
        for (let i = 0; i + want.length <= t.length; i++) {
          const seg = t.slice(i, i + want.length).join(' ').toLowerCase().replace(/[.,;:!?"'’”()]/g, '');
          if (seg === stem.toLowerCase() || seg.startsWith(stem.toLowerCase())) return i;
        }
        return -1;
      })();
      if (r >= 0) positions.push({ sentence: si, position: r });
    });
    return { ...v, positions };
  });

  const sentenceBreaks: Record<string, number[]> = {};
  for (const [k, chunks] of Object.entries(spec.chunks ?? {})) {
    const t = toks[Number(k)];
    if (!t) { errs.push(`chunks[${k}] 문장 없음`); continue; }
    const joined = n(chunks.join(' '));
    if (joined !== n(sentences[Number(k)])) errs.push(`chunks[${k}] 이어붙여도 원문과 다름`);
    const idx: number[] = [];
    let acc = 0;
    chunks.slice(0, -1).forEach((ch) => { acc += n(ch).split(' ').length; idx.push(acc - 1); });
    sentenceBreaks[k] = idx;
  }

  const svocData: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(spec.svoc ?? {})) {
    const t = toks[Number(k)]; if (!t) { errs.push(`svoc[${k}] 문장 없음`); continue; }
    const o: Record<string, unknown> = {};
    const put = (name: string, txt?: string, occ = 1) => {
      if (!txt) return;
      const r = findRange(t, txt, occ, `svoc[${k}].${name}`); if (!r) return;
      o[name] = txt; o[`${name}Start`] = r[0]; o[`${name}End`] = r[1];
    };
    put('subject', v.S, v.Sn); put('verb', v.V, v.Vn); put('object', v.O, v.On); put('complement', v.C, v.Cn);
    svocData[k] = o;
  }

  const syntaxPhrases: Record<string, unknown[]> = {};
  for (const [k, arr] of Object.entries(spec.phrases ?? {})) {
    const t = toks[Number(k)]; if (!t) { errs.push(`phrases[${k}] 문장 없음`); continue; }
    syntaxPhrases[k] = arr.map((ph) => {
      const r = findRange(t, ph.text, ph.occ ?? 1, `phrases[${k}]`);
      const st = styleFor(ph.label);
      return r ? { text: ph.text, label: ph.label, type: st.type, startIndex: r[0], endIndex: r[1], color: st.color, depth: ph.depth ?? 0, modifies: ph.modifies ?? '' } : null;
    }).filter(Boolean) as unknown[];
  }

  const grammarTags = (spec.tags ?? []).map((tg) => {
    const t = toks[tg.s]; if (!t) { errs.push(`tags 문장 ${tg.s} 없음`); return null; }
    const r = findRange(t, tg.text, tg.occ ?? 1, `tags[${tg.s}]`);
    return r ? { sentenceIndex: tg.s, tagName: tg.tag, selectedText: tg.text, startWordIndex: r[0], endWordIndex: r[1], category: tg.cat, explanation: tg.exp } : null;
  }).filter(Boolean);

  const pick = (src: Record<string, string[]> | undefined, ctx: string) => {
    const out: string[] = [];
    for (const [k, words] of Object.entries(src ?? {})) {
      const t = toks[Number(k)]; if (!t) { errs.push(`${ctx}[${k}] 문장 없음`); continue; }
      for (const w of words) { const i = wordIdx(t, w, `${ctx}[${k}]`); if (i !== null) out.push(`${k}:${i}`); }
    }
    return out;
  };

  const main = {
    sentences, koreanSentences,
    analysisResults: spec.comprehensive
      ? { comprehensive: spec.comprehensive }
      : (prevMain.analysisResults ?? {}),
    comprehensiveSlotCount: prevMain.comprehensiveSlotCount ?? 5,
    topicHighlightedSentences: spec.topic ?? [],
    essayHighlightedSentences: spec.essay ?? [],
    grammarSelectedWords: pick(spec.gwords, 'gwords'),
    contextSelectedWords: pick(spec.cwords, 'cwords'),
    sentenceBreaks, svocData, syntaxPhrases, grammarTags,
    grammarPointsBySentence: spec.points ?? {},
    vocabularyList,
  };

  if (errs.length) { console.error(`✖ ${errs.length}건\n` + errs.map((e) => '  · ' + e).join('\n')); process.exit(1); }
  fs.writeFileSync(outPath, JSON.stringify({ passageId: spec.passageId, main }, null, 1));
  console.log(`✓ ${outPath}  문장 ${sentences.length} · 어휘 ${vocabularyList.length} · 어법태그 ${grammarTags.length} · 끊어읽기 ${Object.keys(sentenceBreaks).length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
