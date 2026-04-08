#!/usr/bin/env npx tsx
/**
 * 숙어에 포함된 개별 단어 제거 스크립트.
 * "put off"가 숙어로 등록되어 있으면, 같은 문장·위치에 있는 "put"과 "off"를 삭제.
 *
 * Usage: npx tsx scripts/remove-phrase-parts-once.ts --textbook="26년 3월 고3 영어모의고사"
 *        --apply 로 실행해야 DB 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

async function main() {
  const apply = process.argv.includes('--apply');
  const textbook = process.argv.find((a) => a.startsWith('--textbook='))?.split('=')[1]?.trim();
  if (!textbook) { console.error('--textbook=교재명 필요'); process.exit(1); }

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI 없음'); process.exit(1); }

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

  let totalRemoved = 0;

  for (const doc of docs) {
    const main = (doc as any).passageStates?.main;
    if (!main?.vocabularyList?.length) continue;

    const list: VocabularyEntry[] = main.vocabularyList;
    const phrases = list.filter((v) => v.wordType === 'phrase');
    if (phrases.length === 0) continue;

    const phraseWordPositions = new Set<string>();
    for (const phrase of phrases) {
      const words = phrase.word.toLowerCase().split(/\s+/);
      for (const pos of phrase.positions || []) {
        for (let i = 0; i < words.length; i++) {
          phraseWordPositions.add(`${pos.sentence}:${pos.position + i}:${words[i]}`);
        }
      }
    }

    const toRemove = new Set<number>();
    list.forEach((item, idx) => {
      if (item.wordType === 'phrase') return;
      const word = item.word.toLowerCase();
      const positions = item.positions || [];
      const allCovered = positions.length > 0 && positions.every((p) =>
        phraseWordPositions.has(`${p.sentence}:${p.position}:${word}`)
      );
      if (allCovered) toRemove.add(idx);
    });

    if (toRemove.size === 0) continue;

    const passage = passages.find((p) => `passage:${p._id}` === doc.fileName);
    const pNum = passage?.number || doc.fileName;

    const removed = list.filter((_, i) => toRemove.has(i));
    for (const r of removed) {
      console.log(`  ${pNum}: 삭제 "${r.word}" (숙어에 포함됨)`);
    }

    const newList = list.filter((_, i) => !toRemove.has(i));
    totalRemoved += toRemove.size;

    if (apply) {
      await col.updateOne(
        { _id: doc._id },
        { $set: { 'passageStates.main.vocabularyList': newList, updatedAt: new Date() } },
      );
      console.log(`  → DB 반영 완료 (${list.length} → ${newList.length}개)`);
    }
  }

  console.log(`\n=== 요약: ${totalRemoved}개 단어 삭제${apply ? '' : ' (예정)'} ===`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
