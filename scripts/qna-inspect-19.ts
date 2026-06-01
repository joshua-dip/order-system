/**
 * 26년 5월 고3 영어모의고사 19번 (passageId 69fe3e8d36e33281b7111f79) 의
 * passages.content + passage_analyses.passageStates.main 의 sentences/svocData 정렬 점검.
 *
 * 실행:  MONGODB_URI="..." npx tsx scripts/qna-inspect-19.ts
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const PASSAGE_ID = '69fe3e8d36e33281b7111f79';

async function main() {
  const db = await getDb('gomijoshua');
  const passage = await db.collection('passages').findOne(
    { _id: new ObjectId(PASSAGE_ID) },
    {
      projection: {
        'content.original': 1,
        'content.translation': 1,
        'content.sentences_en': 1,
        'content.sentences_ko': 1,
        source_key: 1,
      },
    }
  );
  if (!passage) {
    console.log('passage not found');
    process.exit(1);
  }
  const c = (passage as { content?: Record<string, unknown> }).content || {};
  const sen_en = (c.sentences_en as string[]) || [];
  const sen_ko = (c.sentences_ko as string[]) || [];
  console.log('=== passages.content ===');
  console.log('sentences_en count:', sen_en.length);
  console.log('sentences_ko count:', sen_ko.length);
  console.log('original chars:', (c.original as string)?.length ?? 0);
  console.log('translation chars:', (c.translation as string)?.length ?? 0);
  console.log('---- sentences_en ----');
  sen_en.forEach((s, i) => console.log(`  [${i}] ${s}`));
  console.log('---- sentences_ko ----');
  sen_ko.forEach((s, i) => console.log(`  [${i}] ${s}`));

  const analysis = await db.collection('passage_analyses').findOne(
    { fileName: passageAnalysisFileNameForPassageId(PASSAGE_ID) },
    {
      projection: {
        'passageStates.main.sentences': 1,
        'passageStates.main.koreanSentences': 1,
        'passageStates.main.svocData': 1,
      },
    }
  );
  if (!analysis) {
    console.log('\n=== analysis: NONE ===');
    process.exit(0);
  }
  const main = (analysis as { passageStates?: { main?: { sentences?: string[]; koreanSentences?: string[]; svocData?: Record<string, unknown> } } })
    .passageStates?.main;
  console.log('\n=== passageStates.main ===');
  console.log('sentences count:', main?.sentences?.length ?? 0);
  console.log('koreanSentences count:', main?.koreanSentences?.length ?? 0);
  console.log('---- main.sentences ----');
  main?.sentences?.forEach((s, i) => console.log(`  [${i}] ${s}`));
  console.log('---- main.koreanSentences ----');
  main?.koreanSentences?.forEach((s, i) => console.log(`  [${i}] ${s}`));

  if (main?.svocData) {
    console.log('---- svocData (raw) ----');
    const sv = main.svocData as Record<string, Record<string, unknown>>;
    for (const k of Object.keys(sv).sort((a, b) => Number(a) - Number(b))) {
      const item = sv[k];
      console.log(`  [${k}] S="${item.subject || ''}" Sstart=${item.subjectStart} Send=${item.subjectEnd} V="${item.verb || ''}" Vstart=${item.verbStart} Vend=${item.verbEnd} C="${item.complement ?? item.subjectComplement ?? ''}"`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
