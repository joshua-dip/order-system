#!/usr/bin/env npx tsx
/**
 * 26년 3월 고1 영어모의고사 단어장에서 숙어(phrase) 누락을 탐지·추가하는 일회성 스크립트.
 *
 * 1) 각 지문의 영문 문장에서 COMMON_PHRASES 사전으로 숙어를 탐지
 * 2) 기존 vocabularyList에 해당 숙어가 없으면 추가
 * 3) --dry  : 변경 없이 리포트만
 *    --apply: DB 실제 반영
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { MongoClient } from 'mongodb';
import { deriveSentencesFromPassageContent } from '../lib/passage-analyzer-passages';
import { passageAnalysisFileNameForPassageId } from '../lib/passage-analyzer-types';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

/* ── 숙어 사전 (passage-analyzer-vocabulary-generate.ts 와 동일) ── */

const COMMON_PHRASES: string[] = [
  'in other words', 'on the other hand', 'as a result', 'in addition',
  'for example', 'for instance', 'in fact', 'as a matter of fact',
  'in contrast', 'on the contrary', 'by contrast', 'in particular',
  'in general', 'in short', 'in brief', 'in summary', 'in conclusion',
  'as well as', 'not only', 'rather than', 'other than',
  'such as', 'as long as', 'as far as', 'as soon as', 'as well',
  'so that', 'in order to', 'so as to',
  'even though', 'even if', 'as though', 'as if',
  'at first', 'at last', 'at least', 'at most', 'at once',
  'at the same time', 'at all', 'after all', 'above all',
  'by the way', 'by means of', 'by no means', 'by far',
  'in terms of', 'in spite of', 'in case of', 'in favor of',
  'in the meantime', 'in the end', 'in turn', 'in advance',
  'on behalf of', 'on purpose', 'on time', 'in time',
  'from time to time', 'little by little', 'side by side',
  'now and then', 'once in a while', 'all of a sudden',
  'come up with', 'come across', 'come about', 'come true',
  'carry out', 'bring about', 'bring up', 'break down', 'break out',
  'figure out', 'find out', 'give up', 'give in', 'give rise to',
  'go on', 'go through', 'grow up', 'hang out',
  'keep up with', 'keep in mind', 'look after', 'look for',
  'look forward to', 'look into', 'look up', 'look up to',
  'make up', 'make sense', 'make sure', 'make use of',
  'pick up', 'point out', 'put off', 'put up with',
  'run into', 'run out of', 'set up', 'set off',
  'show up', 'stand for', 'stand out', 'take advantage of',
  'take care of', 'take for granted', 'take into account',
  'take part in', 'take place', 'take turns', 'take up',
  'think of', 'turn down', 'turn into', 'turn out',
  'used to', 'would rather', 'had better',
  'be able to', 'be about to', 'be likely to', 'be supposed to',
  'be willing to', 'be used to', 'be accustomed to',
  'be aware of', 'be capable of', 'be composed of',
  'be concerned about', 'be familiar with', 'be involved in',
  'be known for', 'be related to', 'be responsible for',
  'be associated with', 'be based on', 'be regarded as',
  'a number of', 'a variety of', 'a great deal of',
  'the number of', 'a series of', 'a kind of',
  'belong to', 'depend on', 'rely on', 'result in', 'result from',
  'consist of', 'contribute to', 'deal with', 'refer to',
  'lead to', 'respond to', 'apply to', 'adapt to', 'adjust to',
  'according to', 'due to', 'owing to', 'thanks to',
  'in spite of', 'regardless of', 'instead of',
  'with regard to', 'with respect to', 'compared to',
  'contrary to', 'prior to', 'subsequent to',
];

/* ── 불규칙 동사 변형 매핑 (과거형/분사 → 원형) ── */

const VERB_BASE_MAP: Record<string, string> = {
  came: 'come', comes: 'come', coming: 'come',
  carried: 'carry', carries: 'carry', carrying: 'carry',
  brought: 'bring', brings: 'bring', bringing: 'bring',
  broke: 'break', breaks: 'break', breaking: 'break', broken: 'break',
  figured: 'figure', figures: 'figure', figuring: 'figure',
  found: 'find', finds: 'find', finding: 'find',
  gave: 'give', gives: 'give', giving: 'give', given: 'give',
  went: 'go', goes: 'go', going: 'go', gone: 'go',
  grew: 'grow', grows: 'grow', growing: 'grow', grown: 'grow',
  hung: 'hang', hangs: 'hang', hanging: 'hang',
  kept: 'keep', keeps: 'keep', keeping: 'keep',
  looked: 'look', looks: 'look', looking: 'look',
  made: 'make', makes: 'make', making: 'make',
  picked: 'pick', picks: 'pick', picking: 'pick',
  pointed: 'point', points: 'point', pointing: 'point',
  put: 'put', puts: 'put', putting: 'put',
  ran: 'run', runs: 'run', running: 'run',
  showed: 'show', shows: 'show', showing: 'show', shown: 'show',
  stood: 'stand', stands: 'stand', standing: 'stand',
  took: 'take', takes: 'take', taking: 'take', taken: 'take',
  thought: 'think', thinks: 'think', thinking: 'think',
  turned: 'turn', turns: 'turn', turning: 'turn',
  led: 'lead', leads: 'lead', leading: 'lead',
  belonged: 'belong', belongs: 'belong', belonging: 'belong',
  depended: 'depend', depends: 'depend', depending: 'depend',
  relied: 'rely', relies: 'rely', relying: 'rely',
  resulted: 'result', results: 'result', resulting: 'result',
  consisted: 'consist', consists: 'consist', consisting: 'consist',
  contributed: 'contribute', contributes: 'contribute', contributing: 'contribute',
  dealt: 'deal', deals: 'deal', dealing: 'deal',
  referred: 'refer', refers: 'refer', referring: 'refer',
  responded: 'respond', responds: 'respond', responding: 'respond',
  applied: 'apply', applies: 'apply', applying: 'apply',
  adapted: 'adapt', adapts: 'adapt', adapting: 'adapt',
  adjusted: 'adjust', adjusts: 'adjust', adjusting: 'adjust',
  was: 'be', were: 'be', is: 'be', am: 'be', been: 'be', being: 'be',
  had: 'have', has: 'have', having: 'have',
  set: 'set', sets: 'set', setting: 'set',
};

function normalizeToken(raw: string): string {
  return raw.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
}

function findPhrasesInText(text: string): { phrase: string; sentenceIndex: number; startWord: number }[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const results: { phrase: string; sentenceIndex: number; startWord: number }[] = [];

  for (let si = 0; si < sentences.length; si++) {
    const words = sentences[si].split(/\s+/).map(normalizeToken);
    for (let wi = 0; wi < words.length; wi++) {
      for (const phrase of COMMON_PHRASES) {
        const pWords = phrase.split(/\s+/);
        if (wi + pWords.length > words.length) continue;
        let match = true;
        for (let k = 0; k < pWords.length; k++) {
          const w = words[wi + k];
          const base = VERB_BASE_MAP[w] || w;
          if (base !== pWords[k] && w !== pWords[k]) { match = false; break; }
        }
        if (match) {
          results.push({ phrase, sentenceIndex: si, startWord: wi });
        }
      }
    }
  }

  return results;
}

function findPhrasesInSentences(sentences: string[]): { phrase: string; sentenceIndex: number; startWord: number }[] {
  const results: { phrase: string; sentenceIndex: number; startWord: number }[] = [];

  for (let si = 0; si < sentences.length; si++) {
    const words = sentences[si].split(/\s+/).map(normalizeToken);
    for (let wi = 0; wi < words.length; wi++) {
      for (const phrase of COMMON_PHRASES) {
        const pWords = phrase.split(/\s+/);
        if (wi + pWords.length > words.length) continue;
        let match = true;
        for (let k = 0; k < pWords.length; k++) {
          const w = words[wi + k];
          const base = VERB_BASE_MAP[w] || w;
          if (base !== pWords[k] && w !== pWords[k]) { match = false; break; }
        }
        if (match) {
          results.push({ phrase, sentenceIndex: si, startWord: wi });
        }
      }
    }
  }

  const seen = new Set<string>();
  const filtered = results.filter((r) => {
    const key = `${r.phrase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filtered.filter((r) => {
    return !filtered.some((other) =>
      other !== r &&
      other.sentenceIndex === r.sentenceIndex &&
      other.startWord <= r.startWord &&
      other.startWord + other.phrase.split(/\s+/).length > r.startWord &&
      other.phrase.length > r.phrase.length,
    );
  });
}

/* ── 메인 ── */

async function main() {
  const dryRun = !process.argv.includes('--apply');
  if (dryRun) console.log('=== DRY RUN (--apply 로 실행하면 DB 반영) ===\n');

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI 없음'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gomijoshua');

  const textbook = '26년 3월 고1 영어모의고사';
  const passages = await db.collection('passages')
    .find({ textbook })
    .project({ _id: 1, chapter: 1, number: 1, content: 1 })
    .sort({ number: 1 })
    .toArray();

  console.log(`지문 수: ${passages.length}\n`);

  let totalAdded = 0;
  let totalAlready = 0;

  for (const p of passages) {
    const pid = String(p._id);
    const fn = passageAnalysisFileNameForPassageId(pid);
    const content = p.content as Record<string, unknown> | undefined;
    const { sentences } = deriveSentencesFromPassageContent(content);

    if (sentences.length === 0) {
      console.log(`  ${p.number}: 문장 없음, 건너뜀`);
      continue;
    }

    const detectedPhrases = findPhrasesInSentences(sentences);
    if (detectedPhrases.length === 0) continue;

    const analysis = await db.collection('passage_analyses').findOne({ fileName: fn });
    const vocabList: VocabularyEntry[] =
      (analysis as Record<string, unknown> | null)?.passageStates
        ? ((analysis as Record<string, unknown>).passageStates as Record<string, unknown>)?.main
          ? (((analysis as Record<string, unknown>).passageStates as Record<string, unknown>).main as Record<string, unknown>)?.vocabularyList as VocabularyEntry[] || []
          : []
        : [];

    const existingWords = new Set(vocabList.map((v) => v.word.toLowerCase()));
    const toAdd: { phrase: string; si: number; wi: number }[] = [];

    for (const dp of detectedPhrases) {
      if (existingWords.has(dp.phrase.toLowerCase())) {
        totalAlready++;
      } else {
        toAdd.push({ phrase: dp.phrase, si: dp.sentenceIndex, wi: dp.startWord });
      }
    }

    if (toAdd.length === 0 && detectedPhrases.length > 0) {
      console.log(`  ${p.number}: 숙어 ${detectedPhrases.length}개 모두 이미 등록됨`);
      continue;
    }

    if (toAdd.length > 0) {
      console.log(`  ${p.number}: 탐지 ${detectedPhrases.length}개 / 누락 ${toAdd.length}개`);
      for (const a of toAdd) {
        console.log(`    + "${a.phrase}" (문장 ${a.si + 1}, 단어 ${a.wi + 1})`);
      }

      if (!dryRun && analysis) {
        const newEntries: VocabularyEntry[] = toAdd.map((a) => ({
          word: a.phrase,
          meaning: '',
          wordType: 'phrase',
          partOfSpeech: 'phrase',
          cefr: '',
          synonym: '',
          antonym: '',
          opposite: '',
          positions: [{ sentence: a.si, position: a.wi }],
        }));

        const updatedList = [...vocabList, ...newEntries];
        await db.collection('passage_analyses').updateOne(
          { fileName: fn },
          { $set: { 'passageStates.main.vocabularyList': updatedList } },
        );
        console.log(`    → DB 반영 완료 (${vocabList.length} → ${updatedList.length})`);
      }

      totalAdded += toAdd.length;
    }
  }

  console.log(`\n=== 요약 ===`);
  console.log(`이미 등록: ${totalAlready}개`);
  console.log(`새로 추가${dryRun ? '(예정)' : ''}: ${totalAdded}개`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
