#!/usr/bin/env npx tsx
/**
 * 동사(v.)인데 -ing 형태인 단어를 동사 원형으로 변환.
 * 예: seeing → see, making → make
 *
 * Usage: npx tsx scripts/fix-ing-to-base-once.ts --textbook="26년 3월 고1 영어모의고사"
 *        --apply  : DB 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

const BATCH = 12;

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
    .project({ _id: 1, number: 1 })
    .sort({ number: 1 })
    .toArray();

  const fileNames = passages.map((p) => `passage:${p._id}`);
  const docs = await col.find({ fileName: { $in: fileNames } }).toArray();

  console.log(`교재: ${textbook} — ${docs.length}개 지문\n`);

  let totalFixed = 0;
  const allNeedsFix: { docId: unknown; pNum: string; items: { oi: number; item: VocabularyEntry }[] }[] = [];

  for (const doc of docs) {
    const main = (doc as any).passageStates?.main;
    if (!main?.vocabularyList?.length) continue;

    const list: VocabularyEntry[] = main.vocabularyList;

    const needsFix = list
      .map((item, oi) => ({ oi, item }))
      .filter(({ item }) => {
        const pos = (item.partOfSpeech || '').toLowerCase();
        if (!pos.startsWith('v')) return false;
        if (item.wordType === 'phrase') return false;
        const w = item.word.toLowerCase();
        return w.endsWith('ing') && w.length >= 5;
      });

    if (needsFix.length === 0) continue;

    const passage = passages.find((p) => `passage:${p._id}` === doc.fileName);
    const pNum = passage?.number as string || doc.fileName;

    console.log(`  ${pNum}: -ing → 원형 대상 ${needsFix.length}개`);
    for (const { item } of needsFix) {
      console.log(`    "${item.word}" (${item.partOfSpeech}) 뜻: "${item.meaning}"`);
    }

    allNeedsFix.push({ docId: doc._id, pNum, items: needsFix });
  }

  const grandTotal = allNeedsFix.reduce((s, x) => s + x.items.length, 0);
  console.log(`\n총 대상: ${grandTotal}개\n`);

  if (!apply || grandTotal === 0) {
    await client.close();
    return;
  }

  for (const { docId, pNum, items } of allNeedsFix) {
    const doc = await col.findOne({ _id: docId as any });
    if (!doc) continue;
    const main = (doc as any).passageStates?.main;
    const list: VocabularyEntry[] = main.vocabularyList;
    const sentences: string[] = main.sentences || [];
    const koreanSentences: string[] = main.koreanSentences || [];

    const resultMap = new Map<number, { baseForm: string; meaning: string; synonym?: string; antonym?: string }>();

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);

      const batchPrompt = batch.map(({ oi, item }, idx) => {
        const ctx = (item.positions || []).slice(0, 2).map((p, j) => {
          const en = sentences[p.sentence] || '';
          const ko = koreanSentences[p.sentence] || '';
          return `${j + 1}. 영어: ${en}\n   한국어: ${ko}`;
        }).join('\n');
        return `[${idx + 1}: "${item.word}" (${item.partOfSpeech})]\n현재 뜻: ${item.meaning || '(없음)'}\n문맥:\n${ctx || '(문맥 없음)'}`;
      }).join('\n\n');

      const prompt = `다음 영어 동사들이 -ing(동명사/현재분사) 형태입니다. 동사 원형으로 변환하고 뜻도 원형에 맞게 수정해주세요.

${batchPrompt}

각 항목마다 아래 형식으로만 답변:
[N] 원형: [동사원형] | 뜻: [한국어 뜻(~하다 형태)] | 유의어: [영어 유의어] | 반의어: [영어 반의어, 없으면 없음]

규칙:
- seeing → see, making → make, running → run 등 동사 원형으로
- 뜻은 동사형(~하다, ~되다)으로
- 유의어·반의어도 기본형으로

답변:`;

      try {
        const msg = await anthropic.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] });
        const text = (msg.content[0] as { type: string; text: string }).text.trim();
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          const match = line.match(/\[(\d+)\]\s*원형:\s*(.+?)\s*\|\s*뜻:\s*(.+?)(?:\s*\|\s*유의어:\s*(.+?))?(?:\s*\|\s*반의어:\s*(.+?))?$/);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            if (idx >= 0 && idx < batch.length) {
              const baseForm = match[2].trim();
              const meaning = match[3].trim();
              const synonym = match[4]?.trim() || '';
              const antonym = match[5]?.trim() || '';
              resultMap.set(batch[idx].oi, {
                baseForm,
                meaning,
                synonym: synonym === '없음' ? '' : synonym,
                antonym: antonym === '없음' ? '' : antonym,
              });
              console.log(`    ✓ "${batch[idx].item.word}" → "${baseForm}" 뜻: "${meaning}"`);
            }
          }
        }
      } catch (e) {
        console.error('    배치 오류:', e instanceof Error ? e.message : e);
      }

      if (i + BATCH < items.length) await new Promise((r) => setTimeout(r, 200));
    }

    if (resultMap.size > 0) {
      const updated = list.map((v, idx) => {
        const fix = resultMap.get(idx);
        if (!fix) return v;
        return {
          ...v,
          word: fix.baseForm,
          meaning: fix.meaning,
          ...(fix.synonym ? { synonym: fix.synonym } : {}),
          ...(fix.antonym ? { antonym: fix.antonym } : {}),
        };
      });

      await col.updateOne(
        { _id: docId as any },
        { $set: { 'passageStates.main.vocabularyList': updated, updatedAt: new Date() } },
      );
      totalFixed += resultMap.size;
      console.log(`  ${pNum}: DB 반영 완료 (${resultMap.size}개 수정)`);
    }
  }

  console.log(`\n=== 요약: ${totalFixed}개 단어 원형 변환 완료 ===`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
