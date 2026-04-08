#!/usr/bin/env npx tsx
/**
 * 단어장이 없는 지문에 대해 일괄로:
 *   1) 영문 문장에서 단어 추출 (숙어 포함)
 *   2) passage_analyses 문서 생성/업데이트
 *   3) AI로 뜻·CEFR·유의어·반의어 채우기
 *   4) 품질 보정 (단수화, 한글 복수, 약어)
 *
 * Usage: npx tsx scripts/init-vocabulary-batch.ts --textbook="26년 3월 고3 영어모의고사"
 *        --dry  : 추출만, DB 저장 안 함
 *        --no-ai: AI 분석 건너뜀 (추출만)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { deriveSentencesFromPassageContent } from '../lib/passage-analyzer-passages';
import { passageAnalysisFileNameForPassageId } from '../lib/passage-analyzer-types';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';
import { buildVocabularyListFromSentences } from '../lib/passage-analyzer-vocabulary-generate';
import { parseWordBlock } from '../lib/passage-analyzer-vocabulary';
import { toBaseForm, toBaseFormList } from '../lib/passage-analyzer-vocabulary-generate';

const BATCH = 12;

const NOISE_WORDS = new Set(['st', 'nd', 'rd', 'th', 'etc', 'll', 've', 're', 'd', 'm', 'o', 's', 't']);
const KNOWN_ABBREVIATIONS: Record<string, string> = {
  bc: 'BC', ad: 'AD', eu: 'EU', un: 'UN', uk: 'UK',
  dna: 'DNA', rna: 'RNA', ai: 'AI', gps: 'GPS', ceo: 'CEO',
  tv: 'TV', pc: 'PC', ok: 'OK', iq: 'IQ',
};

function fixPluralSuffix(meaning: string): string {
  return meaning.replace(/([가-힣])들(?=[,\s·;]|$)/g, '$1');
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const noAi = process.argv.includes('--no-ai');
  const textbook = process.argv.find((a) => a.startsWith('--textbook='))?.split('=')[1]?.trim();
  if (!textbook) { console.error('--textbook=교재명 필요'); process.exit(1); }

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI 없음'); process.exit(1); }

  let anthropic: Anthropic | null = null;
  let model = '';
  if (!noAi) {
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) { console.error('ANTHROPIC_API_KEY 없음'); process.exit(1); }
    anthropic = new Anthropic({ apiKey });
    model = (process.env.ANTHROPIC_SOLVE_MODEL || '').trim() || 'claude-haiku-4-5-20251001';
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gomijoshua');
  const col = db.collection('passage_analyses');

  const passages = await db.collection('passages')
    .find({ textbook })
    .project({ _id: 1, chapter: 1, number: 1, content: 1 })
    .sort({ number: 1 })
    .toArray();

  console.log(`교재: ${textbook} — ${passages.length}개 지문\n`);

  let totalWords = 0;
  let totalPhrases = 0;

  for (const p of passages) {
    const pid = String(p._id);
    const fn = passageAnalysisFileNameForPassageId(pid);
    const content = p.content as Record<string, unknown> | undefined;
    const { sentences, koreanSentences } = deriveSentencesFromPassageContent(content);

    if (sentences.length === 0) {
      console.log(`  ${p.number}: 문장 없음, 건너뜀`);
      continue;
    }

    const existing = await col.findOne({ fileName: fn });
    const existingVocab: VocabularyEntry[] =
      (existing as any)?.passageStates?.main?.vocabularyList || [];

    if (existingVocab.length > 0) {
      console.log(`  ${p.number}: 이미 ${existingVocab.length}개 단어 있음, 건너뜀`);
      continue;
    }

    /* 1) 단어 추출 (숙어 포함) */
    let vocabList = buildVocabularyListFromSentences(sentences, {
      sourcePassage: p.number as string,
    });

    const phrases = vocabList.filter((v) => v.wordType === 'phrase');
    const words = vocabList.filter((v) => v.wordType !== 'phrase');
    console.log(`  ${p.number}: ${words.length}단어 + ${phrases.length}숙어 추출`);
    totalWords += words.length;
    totalPhrases += phrases.length;

    /* 2) AI 분석 */
    if (anthropic && !noAi) {
      const needsAnalysis = vocabList.filter((v) => !v.meaning?.trim());
      console.log(`    AI 분석 대상: ${needsAnalysis.length}개 (모델: ${model})`);

      const resultMap = new Map<string, Record<string, unknown>>();

      for (let i = 0; i < needsAnalysis.length; i += BATCH) {
        const batch = needsAnalysis.slice(i, i + BATCH);

        const batchPrompt = batch
          .map((item, idx) => {
            const pos = item.positions || [];
            const ctx = pos
              .slice(0, 2)
              .map((pp, j) => {
                const en = sentences[pp.sentence] || '';
                const ko = koreanSentences[pp.sentence] || '';
                return `${j + 1}. 영어: ${en}\n   한국어: ${ko}`;
              })
              .join('\n');
            return `[단어 ${idx + 1}: "${item.word}"]\n문맥:\n${ctx || '(문맥 없음)'}`;
          })
          .join('\n\n');

        const prompt = `다음 영어 단어/숙어들을 문맥에 맞게 각각 종합 분석해주세요.

${batchPrompt}

각 단어마다 아래 형식으로만 답변하세요.
[단어 N: "단어"]
유형: [word 또는 phrase]
품사: [n., v., adj. 등]
CEFR: [반드시 A1, A2, B1, B2, C1, C2 중 하나만]
뜻: [문맥에 맞는 주요 뜻, 한국어 단수 명사형]
부가뜻: [부가 한글 의미, 없으면 없음]
영어유의어: [뜻이 같은 영어 단어·구만 쉼표로, 기본형]
영어반의어: [뜻이 반대인 영어 단어, 없으면 없음, 기본형]

중요:
- 뜻은 반드시 단수 명사형으로 (예: "공무원들" ✗ → "공무원" ✓)
- 영어유의어·영어반의어는 기본형(단수·원형)으로
- "영어반의어"에는 유의어를 넣지 마세요

답변:`;

        try {
          const msg = await anthropic.messages.create({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
          const text = (msg.content[0] as { type: string; text: string }).text.trim();
          const splits = text.split(/(?=\[단어\s*\d+[^\]]*\])/i);
          const blocks = splits.filter((s) => /\[단어\s*\d+/i.test(s));
          const effectiveBlocks = blocks.length >= batch.length ? blocks : [text];

          for (let j = 0; j < batch.length; j++) {
            const block = effectiveBlocks[j] || effectiveBlocks[0] || text;
            const item = batch[j];
            const parsed = parseWordBlock(block, item as unknown as Record<string, unknown>);
            resultMap.set(item.word, parsed);
          }
        } catch (e) {
          console.error(`    배치 오류:`, e instanceof Error ? e.message : e);
          for (const item of batch) resultMap.set(item.word, item as unknown as Record<string, unknown>);
        }

        if (i + BATCH < needsAnalysis.length) await new Promise((r) => setTimeout(r, 200));
        process.stderr.write(`    ${Math.min(i + BATCH, needsAnalysis.length)}/${needsAnalysis.length} 완료\r`);
      }
      console.log('');

      vocabList = vocabList.map((v) => {
        const r = resultMap.get(v.word);
        return r ? { ...v, ...r } as unknown as VocabularyEntry : v;
      });
    }

    /* 3) 품질 보정 */
    vocabList = vocabList
      .filter((v) => !NOISE_WORDS.has(v.word.toLowerCase()))
      .map((v) => {
        let item = { ...v };
        const abbr = KNOWN_ABBREVIATIONS[item.word.toLowerCase()];
        if (abbr && item.word !== abbr) item.word = abbr;
        if (item.wordType !== 'phrase') {
          const base = toBaseForm(item.word);
          if (base !== item.word) item.word = base;
        }
        if (item.meaning) item.meaning = fixPluralSuffix(item.meaning);
        for (const field of ['synonym', 'antonym', 'opposite'] as const) {
          if (item[field]) item = { ...item, [field]: toBaseFormList(item[field]!) };
        }
        return item;
      });

    const filled = vocabList.filter((v) => v.meaning?.trim()).length;
    console.log(`    최종: ${vocabList.length}개 (뜻 있음: ${filled})`);

    /* 4) 저장 */
    if (!dryRun) {
      const now = new Date();
      if (existing) {
        await col.updateOne(
          { fileName: fn },
          {
            $set: {
              'passageStates.main.vocabularyList': vocabList,
              'passageStates.main.sentences': sentences,
              'passageStates.main.koreanSentences': koreanSentences,
              updatedAt: now,
            },
          },
        );
      } else {
        await col.insertOne({
          fileName: fn,
          passageStates: {
            main: {
              sentences,
              koreanSentences,
              vocabularyList: vocabList,
            },
          },
          createdAt: now,
          updatedAt: now,
          version: 1,
          lastEditorId: 'cli',
          lastEditorName: 'init-vocab-batch',
          lastSaved: now.toISOString(),
        });
      }
      console.log(`    → DB 저장 완료`);
    }
  }

  console.log(`\n=== 요약 ===`);
  console.log(`단어: ${totalWords}, 숙어: ${totalPhrases}`);
  if (dryRun) console.log('(dry-run — 실제 저장 없음)');

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
