#!/usr/bin/env npx tsx
/**
 * 동사(v.)인데 뜻이 명사형으로 되어있는 항목을 AI로 동사형으로 수정.
 * 예: "기대 · 설렘, 기다림" → "기대하다 · 설레다, 기다리다"
 *
 * Usage: npx tsx scripts/fix-verb-meanings-once.ts --textbook="26년 3월 고1 영어모의고사"
 *        --apply  : DB 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

const BATCH = 15;

function isNounishMeaning(meaning: string): boolean {
  if (!meaning?.trim()) return false;
  const parts = meaning.split(/[·,;]/);
  const first = parts[0].trim().replace(/\s+/g, '');
  if (!first) return false;
  if (first.endsWith('다')) return false;
  if (first.endsWith('기') && first.length > 1) return true;
  if (/[가-힣]$/.test(first) && !first.endsWith('다')) return true;
  return false;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const textbook = process.argv.find((a) => a.startsWith('--textbook='))?.split('=')[1]?.trim();
  if (!textbook) { console.error('--textbook=교재명 필요'); process.exit(1); }

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI 없음'); process.exit(1); }

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) { console.error('ANTHROPIC_API_KEY 없음'); process.exit(1); }
  const anthropic = new Anthropic({ apiKey });
  const model = (process.env.ANTHROPIC_SOLVE_MODEL || '').trim() || 'claude-haiku-4-5-20251001';

  if (!apply) console.log('=== DRY RUN (--apply 로 실행하면 DB 반영) ===\n');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gomijoshua');
  const col = db.collection('passage_analyses');

  const passages = await db.collection('passages')
    .find({ textbook })
    .project({ _id: 1, number: 1, content: 1 })
    .sort({ number: 1 })
    .toArray();

  const fileNames = passages.map((p) => `passage:${p._id}`);
  const docs = await col.find({ fileName: { $in: fileNames } }).toArray();

  console.log(`교재: ${textbook} — ${docs.length}개 지문\n`);

  let totalFixed = 0;

  for (const doc of docs) {
    const main = (doc as any).passageStates?.main;
    if (!main?.vocabularyList?.length) continue;

    const list: VocabularyEntry[] = main.vocabularyList;
    const sentences: string[] = main.sentences || [];
    const koreanSentences: string[] = main.koreanSentences || [];

    const needsFix = list.filter((v) => {
      const pos = (v.partOfSpeech || '').toLowerCase();
      if (!pos.startsWith('v')) return false;
      return isNounishMeaning(v.meaning || '');
    });

    if (needsFix.length === 0) continue;

    const passage = passages.find((p) => `passage:${p._id}` === doc.fileName);
    const pNum = passage?.number || doc.fileName;

    console.log(`  ${pNum}: 동사 뜻 보정 대상 ${needsFix.length}개`);
    for (const v of needsFix) {
      console.log(`    "${v.word}" (${v.partOfSpeech}) → 현재 뜻: "${v.meaning}"`);
    }

    if (!apply) continue;

    const resultMap = new Map<string, string>();

    for (let i = 0; i < needsFix.length; i += BATCH) {
      const batch = needsFix.slice(i, i + BATCH);

      const batchPrompt = batch.map((item, idx) => {
        const pos = item.positions || [];
        const ctx = pos.slice(0, 2).map((p, j) => {
          const en = sentences[p.sentence] || '';
          const ko = koreanSentences[p.sentence] || '';
          return `${j + 1}. 영어: ${en}\n   한국어: ${ko}`;
        }).join('\n');
        return `[${idx + 1}: "${item.word}" (${item.partOfSpeech})]\n현재 뜻: ${item.meaning}\n문맥:\n${ctx || '(문맥 없음)'}`;
      }).join('\n\n');

      const prompt = `다음 영어 동사/동사구의 한국어 뜻이 명사형으로 되어 있습니다.
문맥에 맞게 동사형(~하다, ~되다, ~이다 등)으로 수정해주세요.

${batchPrompt}

각 항목마다 아래 형식으로만 답변:
[N] 수정된 뜻

규칙:
- 뜻은 반드시 동사형으로 (예: "기대" → "기대하다", "설렘" → "설레다")
- 기존 구조(· 구분, 부가뜻)를 유지
- 문맥에 맞는 뜻으로
- 한국어 단수형 사용

답변:`;

      try {
        const msg = await anthropic.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] });
        const text = (msg.content[0] as { type: string; text: string }).text.trim();
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          const match = line.match(/\[(\d+)\]\s*(.+)/);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            const newMeaning = match[2].trim();
            if (idx >= 0 && idx < batch.length && newMeaning) {
              resultMap.set(batch[idx].word, newMeaning);
              console.log(`    ✓ "${batch[idx].word}": "${batch[idx].meaning}" → "${newMeaning}"`);
            }
          }
        }
      } catch (e) {
        console.error('    배치 오류:', e instanceof Error ? e.message : e);
      }

      if (i + BATCH < needsFix.length) await new Promise((r) => setTimeout(r, 200));
    }

    if (resultMap.size > 0) {
      const updated = list.map((v) => {
        const fix = resultMap.get(v.word);
        return fix ? { ...v, meaning: fix } : v;
      });

      await col.updateOne(
        { _id: doc._id },
        { $set: { 'passageStates.main.vocabularyList': updated, updatedAt: new Date() } },
      );
      totalFixed += resultMap.size;
      console.log(`    → DB 반영 완료 (${resultMap.size}개 수정)`);
    }
  }

  console.log(`\n=== 요약: ${totalFixed}개 뜻 수정${apply ? '' : ' (예정)'} ===`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
