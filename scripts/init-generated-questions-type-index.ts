/**
 * 1회성: generated_questions 에 { type, textbook, passage_id } 복합 인덱스 추가.
 * 워크북어법 $ne 필터 등에 효과적.
 * 실행: npx tsx scripts/init-generated-questions-type-index.ts
 */
import { getDb } from '../lib/mongodb';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  console.log('creating index { type: 1, textbook: 1, passage_id: 1 } ...');
  await col.createIndex(
    { type: 1, textbook: 1, passage_id: 1 },
    { name: 'type_textbook_passage_id' },
  );

  console.log('done. current indexes:');
  const indexes = await col.indexes();
  for (const idx of indexes) {
    console.log(' ', idx.name, JSON.stringify(idx.key));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
