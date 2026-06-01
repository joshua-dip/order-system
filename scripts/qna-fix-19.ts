/**
 * 26년 5월 고3 영어모의고사 19번 (passageId 69fe3e8d36e33281b7111f79) 의 데이터 정렬 수정.
 *
 * - passages.content.sentences_en / sentences_ko 를 passage_analyses.passageStates.main 의
 *   18-split (분석기가 본 sentence segmentation) 로 교체.
 * - svocData 는 그대로 유지 — main.sentences 와 1:1 정렬이라 정합성 회복.
 * - qna_threads 에 옛 15-index 기반 thread 가 있으면 먼저 알려주고 abort (수동 검토 필요).
 *
 * 실행:
 *   MONGODB_URI="..." npx tsx scripts/qna-fix-19.ts            (dry-run, 변경 안 함)
 *   MONGODB_URI="..." npx tsx scripts/qna-fix-19.ts --apply    (실제 update)
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const PASSAGE_ID = '69fe3e8d36e33281b7111f79';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');

  // 1) 현재 passages 상태
  const passage = await db.collection('passages').findOne(
    { _id: new ObjectId(PASSAGE_ID) },
    { projection: { 'content.sentences_en': 1, 'content.sentences_ko': 1, source_key: 1 } }
  );
  if (!passage) {
    console.error('[abort] passage not found:', PASSAGE_ID);
    process.exit(1);
  }
  const c = (passage as { content?: Record<string, unknown> }).content || {};
  const oldEn = (c.sentences_en as string[]) || [];
  const oldKo = (c.sentences_ko as string[]) || [];

  // 2) 분석기 sentences
  const analysis = await db.collection('passage_analyses').findOne(
    { fileName: passageAnalysisFileNameForPassageId(PASSAGE_ID) },
    { projection: { 'passageStates.main.sentences': 1, 'passageStates.main.koreanSentences': 1 } }
  );
  if (!analysis) {
    console.error('[abort] passage_analyses not found');
    process.exit(1);
  }
  const main = (analysis as { passageStates?: { main?: { sentences?: string[]; koreanSentences?: string[] } } })
    .passageStates?.main;
  const newEn = main?.sentences ?? [];
  const newKo = main?.koreanSentences ?? [];
  if (newEn.length === 0 || newKo.length === 0) {
    console.error('[abort] analyzer main.sentences or koreanSentences is empty');
    process.exit(1);
  }
  if (newEn.length !== newKo.length) {
    console.error(
      `[abort] analyzer sentence count mismatch: en=${newEn.length} ko=${newKo.length}`
    );
    process.exit(1);
  }

  // 3) 기존 thread 가 옛 index 를 쓰고 있으면 위험
  const threadCol = db.collection('qna_threads');
  const oldThreads = await threadCol
    .find({ passageId: new ObjectId(PASSAGE_ID) })
    .project({ sentenceIndex: 1, question: 1, asker: 1 })
    .toArray();
  console.log(`existing qna_threads for this passage: ${oldThreads.length}`);
  for (const t of oldThreads) {
    const tt = t as { _id: ObjectId; sentenceIndex: number; question?: string; asker?: { nickname?: string } };
    console.log(`  - _id=${tt._id} sentenceIdx=${tt.sentenceIndex} by=${tt.asker?.nickname} q="${(tt.question || '').slice(0, 40)}"`);
  }
  if (oldThreads.length > 0) {
    console.warn(
      '\n[warning] threads 가 존재합니다. 18-split 으로 바꾸면 sentenceIndex 가 어긋날 수 있어요.'
    );
    console.warn(
      '          현재 15 → 18 split 매핑은 수동 검토가 필요합니다.'
    );
    console.warn(
      '          (지문 전체 질문 sentenceIndex=-1 만 있으면 안전.)'
    );
    const allFullPassage = oldThreads.every(
      (t) => (t as { sentenceIndex: number }).sentenceIndex === -1
    );
    if (!allFullPassage) {
      console.error('[abort] 일부 thread 가 특정 sentence 에 묶여 있어 자동 진행 불가. 먼저 수동 정리.');
      process.exit(1);
    }
    console.log('[ok] 모든 thread 가 sentenceIndex=-1 (지문 전체 질문). 안전.');
  }

  console.log('\n=== 변경 전 (현재 sentences_en) ===');
  oldEn.forEach((s, i) => console.log(`  [${i}] ${s}`));
  console.log('\n=== 변경 후 (analyzer sentences) ===');
  newEn.forEach((s, i) => console.log(`  [${i}] ${s}`));

  if (!apply) {
    console.log('\n[dry-run] 변경 안 함. 실제 적용은 --apply 옵션.');
    process.exit(0);
  }

  // 4) 적용
  const res = await db.collection('passages').updateOne(
    { _id: new ObjectId(PASSAGE_ID) },
    {
      $set: {
        'content.sentences_en': newEn,
        'content.sentences_ko': newKo,
        updated_at: new Date(),
      },
    }
  );
  console.log('\n[apply]', { matched: res.matchedCount, modified: res.modifiedCount });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
