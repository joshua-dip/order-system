#!/usr/bin/env npx tsx
/**
 * 26년 3월 고1 영어모의고사 단어장의 phrase 항목 중
 * meaning이 비어있는 항목에 AI로 뜻·유의어·반의어·CEFR을 채우는 일회성 스크립트.
 *
 * --dry  : 변경 없이 대상만 표시
 * --apply: DB 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { passageAnalysisFileNameForPassageId } from '../lib/passage-analyzer-types';
import { deriveSentencesFromPassageContent } from '../lib/passage-analyzer-passages';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  if (dryRun) console.log('=== DRY RUN (--apply 로 실행하면 DB 반영) ===\n');

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI 없음'); process.exit(1); }
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) { console.error('ANTHROPIC_API_KEY 없음'); process.exit(1); }

  const model = (process.env.ANTHROPIC_SOLVE_MODEL || '').trim() || 'claude-haiku-4-5-20251001';
  const anthropic = new Anthropic({ apiKey });

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gomijoshua');

  const textbook = process.argv.find((a) => a.startsWith('--textbook='))?.split('=')[1]?.trim()
    || '26년 3월 고1 영어모의고사';
  const passages = await db.collection('passages')
    .find({ textbook })
    .project({ _id: 1, chapter: 1, number: 1, content: 1 })
    .sort({ number: 1 })
    .toArray();

  console.log(`지문 수: ${passages.length}\n`);

  let totalFilled = 0;

  for (const p of passages) {
    const pid = String(p._id);
    const fn = passageAnalysisFileNameForPassageId(pid);
    const content = p.content as Record<string, unknown> | undefined;
    const { sentences, koreanSentences } = deriveSentencesFromPassageContent(content);

    const analysis = await db.collection('passage_analyses').findOne({ fileName: fn });
    if (!analysis) continue;

    const vocabList: VocabularyEntry[] =
      ((analysis as Record<string, unknown>).passageStates as Record<string, unknown>)?.main
        ? (((analysis as Record<string, unknown>).passageStates as Record<string, unknown>).main as Record<string, unknown>)?.vocabularyList as VocabularyEntry[] || []
        : [];

    const emptyPhrases = vocabList.filter(
      (v) => v.wordType === 'phrase' && (!v.meaning || !v.meaning.trim()),
    );
    if (emptyPhrases.length === 0) continue;

    console.log(`${p.number}: 뜻 없는 숙어 ${emptyPhrases.length}개`);
    for (const ep of emptyPhrases) {
      const pos = ep.positions?.[0];
      const enCtx = pos ? sentences[pos.sentence] || '' : '';
      const koCtx = pos ? koreanSentences[pos.sentence] || '' : '';
      console.log(`  "${ep.word}" → 문장: "${enCtx.slice(0, 60)}…"`);
      if (koCtx) console.log(`             해석: "${koCtx.slice(0, 60)}…"`);
    }

    if (dryRun) continue;

    const batchPrompt = emptyPhrases
      .map((ep, idx) => {
        const pos = ep.positions?.[0];
        const enCtx = pos ? sentences[pos.sentence] || '' : '';
        const koCtx = pos ? koreanSentences[pos.sentence] || '' : '';
        return `[숙어 ${idx + 1}: "${ep.word}"]\n문맥:\n1. 영어: ${enCtx}\n   한국어: ${koCtx}`;
      })
      .join('\n\n');

    const prompt = `다음 영어 숙어들을 문맥에 맞게 분석해주세요.

${batchPrompt}

각 숙어마다 아래 형식으로만 답변하세요:
[숙어 N: "숙어"]
CEFR: [A1, A2, B1, B2, C1, C2 중 하나]
뜻: [문맥에 맞는 주요 한국어 뜻, 단수 명사형]
부가뜻: [다른 한국어 표현, 없으면 없음]
영어유의어: [같은 뜻의 영어 표현, 쉼표로 구분]
영어반의어: [반대 뜻의 영어 표현, 없으면 없음]

중요:
- 뜻은 반드시 해당 지문·문맥에서의 의미로 쓰세요.
- 뜻은 단수 명사형으로 쓰세요.
- 영어유의어·영어반의어는 기본형으로 쓰세요.

답변:`;

    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      const splits = text.split(/(?=\[숙어\s*\d+[^\]]*\])/i);
      const blocks = splits.filter((s) => /\[숙어\s*\d+/i.test(s));

      const updatedList = [...vocabList];

      for (let j = 0; j < emptyPhrases.length; j++) {
        const block = blocks[j] || '';
        const ep = emptyPhrases[j];
        const idx = updatedList.findIndex((v) => v.word === ep.word && v.wordType === 'phrase');
        if (idx < 0) continue;

        const matchLine = (pattern: RegExp): string => {
          const m = block.match(pattern);
          return m ? m[1].trim().replace(/^["']+|["']+$/g, '') : '';
        };

        const meaningMain = matchLine(/뜻:\s*(.+?)(?=\n|$)/i);
        const meaningExtra = matchLine(/부가뜻:\s*(.+?)(?=\n|$)/i);
        const cefr = matchLine(/CEFR:\s*(.+?)(?=\n|$)/i);
        const synonym = matchLine(/영어유의어:\s*(.+?)(?=\n|$)/i);
        const antonym = matchLine(/영어반의어:\s*(.+?)(?=\n|$)/i);

        let meaning = meaningMain;
        if (meaningExtra && meaningExtra !== '없음' && meaningExtra !== '-') {
          meaning = meaning ? `${meaning} · ${meaningExtra}` : meaningExtra;
        }

        if (meaning) {
          updatedList[idx] = {
            ...updatedList[idx],
            meaning,
            cefr: cefr || updatedList[idx].cefr || '',
            synonym: synonym && synonym !== '없음' ? synonym : updatedList[idx].synonym || '',
            antonym: antonym && antonym !== '없음' ? antonym : updatedList[idx].antonym || '',
          };
          console.log(`  ✓ "${ep.word}" → ${meaning} (${cefr})`);
          totalFilled++;
        }
      }

      await db.collection('passage_analyses').updateOne(
        { fileName: fn },
        { $set: { 'passageStates.main.vocabularyList': updatedList } },
      );
    } catch (e) {
      console.error(`  ✗ ${p.number} AI 분석 실패:`, e instanceof Error ? e.message : e);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n=== 완료: ${totalFilled}개 숙어 뜻 채움 ===`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
