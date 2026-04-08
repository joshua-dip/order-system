#!/usr/bin/env npx tsx
/**
 * 단어장에서 고유명사(사람 이름 등)를 제거.
 * 판단 기준:
 *   1. 문장 중간(position > 0)에서 대문자로 시작 → 확실한 고유명사
 *   2. 문장 시작(position 0)에만 등장 + 일반적 영단어가 아닌 경우 → 의심 고유명사
 *
 * Usage: npx tsx scripts/remove-proper-nouns-once.ts --textbook="26년 3월 고1 영어모의고사"
 *        --apply  : DB 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

const COMMON_WORDS = new Set([
  'after', 'also', 'although', 'amazingly', 'among', 'available', 'award',
  'basic', 'because', 'become', 'before', 'besides', 'bombard', 'borrow',
  'building', 'but', 'century', 'clear', 'commuter', 'comparative',
  'consequently', 'create', 'date', 'dear', 'despite', 'detail',
  'discipline', 'during', 'early', 'even', 'every', 'event',
  'far', 'farther', 'fascinate', 'fee', 'first', 'further',
  'green', 'guideline', 'having', 'hey', 'however', 'imagine',
  'implant', 'indeed', 'initially', 'instead', 'ironically',
  'join', 'judging', 'judgment', 'just', 'knowing', 'later',
  'learn', 'let', 'library', 'like', 'look', 'make', 'many',
  'mathematics', 'morality', 'nonetheless', 'nowadays',
  'older', 'once', 'one', 'open', 'operating', 'over',
  'paint', 'parenting', 'part', 'people', 'perhaps', 'picture',
  'plus', 'political', 'premium', 'process', 'raise', 'rather',
  'reconsider', 'regarding', 'registration', 'reluctantly',
  'repeate', 'revision', 'rich', 'river', 'room', 'save',
  'scholar', 'sciama', 'several', 'similarly', 'simple', 'since',
  'sincerely', 'sometimes', 'something', 'soon', 'standardization',
  'start', 'streamlining', 'successful', 'take', 'thank',
  'therefore', 'time', 'type', 'ultimately', 'under',
  'understanding', 'unfortunately', 'unlike', 'upon',
  'widely', 'without', 'writing', 'young', 'zoom',
  'accompany', 'announce', 'approach', 'archaeological',
  'author', 'base', 'become', 'benefit', 'build', 'compare',
  'complete', 'conduct', 'contain', 'cultivate', 'decline',
  'define', 'develop', 'dismiss', 'display', 'distribute',
  'do', 'done', 'earn', 'emit', 'establish', 'equip', 'expect',
  'explore', 'express', 'flag', 'generate', 'give', 'go',
  'have', 'help', 'hinder', 'hold', 'increase', 'incorporate',
  'know', 'lend', 'locate', 'move', 'narrow', 'overcome',
  'play', 'pretend', 'pursue', 'reduce', 'reinforce',
  'research', 'respond', 'say', 'see', 'shape', 'share',
  'stay', 'think', 'use', 'visualize', 'wait', 'write',
  'allow', 'bring', 'clarify', 'come', 'determine', 'record',
  'return', 'ingroup', 'nowaday', 'nowadays',
]);

function isLikelyProperNoun(word: string, positions: { sentence: number; position: number }[], sentences: string[]): boolean {
  if (!word || word.length <= 1) return false;
  if (/^[A-Z]{2,}$/.test(word)) return false;
  if (word.includes("'")) return false;

  let hasMidSentenceCap = false;

  for (const p of positions) {
    const rawWords = sentences[p.sentence]?.split(/\s+/) || [];
    const raw = rawWords[p.position] || '';
    const alpha = raw.replace(/^[^A-Za-z]+/, '');
    if (!alpha) continue;

    if (p.position > 0 && /^[A-Z][a-z]/.test(alpha)) {
      hasMidSentenceCap = true;
      break;
    }
  }

  if (hasMidSentenceCap) return true;

  const allAtStart = positions.every((p) => p.position === 0);
  if (allAtStart) {
    const w = word.toLowerCase();
    if (COMMON_WORDS.has(w)) return false;
    if (/(?:ing|tion|sion|ment|ness|ous|ive|ful|less|ble|ally|ily|ity|ize|ise|ent|ant|ary|ery|ory|ure|age|ism|ist|ate|ify|ical|ence|ance|ward|wards|ling|ship|dom|ology|graphy|fully|ingly|ously|ively|lessly|ably|ibly|edly|ened|ered|lish|ther|ound|ween)$/.test(w)) return false;
    return true;
  }

  return false;
}

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
    const sentences: string[] = main.sentences || [];

    const toRemoveIdxs = new Set<number>();

    list.forEach((item, idx) => {
      if (item.wordType === 'phrase') return;
      if (isLikelyProperNoun(item.word, item.positions || [], sentences)) {
        toRemoveIdxs.add(idx);
      }
    });

    if (toRemoveIdxs.size === 0) continue;

    const passage = passages.find((p) => `passage:${p._id}` === doc.fileName);
    const pNum = passage?.number || doc.fileName;

    const removed = list.filter((_, i) => toRemoveIdxs.has(i));
    for (const r of removed) {
      const posInfo = (r.positions || []).map((p) => `${p.sentence + 1}-${p.position + 1}`).join(', ');
      console.log(`  ${pNum}: 삭제 "${r.word}" [${posInfo}]`);
    }

    if (apply) {
      const newList = list.filter((_, i) => !toRemoveIdxs.has(i));
      await col.updateOne(
        { _id: doc._id },
        { $set: { 'passageStates.main.vocabularyList': newList, updatedAt: new Date() } },
      );
      console.log(`  → DB 반영 (${list.length} → ${newList.length}개)`);
    }
    totalRemoved += toRemoveIdxs.size;
  }

  console.log(`\n=== 요약: ${totalRemoved}개 고유명사 삭제${apply ? '' : ' (예정)'} ===`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
