/**
 * 1회성: generated_workbooks 컬렉션에 인덱스를 생성합니다.
 * 실행: npx tsx scripts/init-generated-workbooks-indexes.ts
 */
import { getDb } from '../lib/mongodb';
import { GENERATED_WORKBOOKS_COLLECTION } from '../lib/generated-workbooks-types';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection(GENERATED_WORKBOOKS_COLLECTION);

  console.log('creating indexes on', GENERATED_WORKBOOKS_COLLECTION, '...');

  await col.createIndex(
    { passage_id: 1, created_at: -1 },
    { name: 'passage_id_created_at' },
  );

  await col.createIndex(
    { textbook: 1, created_at: -1 },
    { name: 'textbook_created_at' },
  );

  await col.createIndex(
    { category: 1 },
    { name: 'category' },
  );

  console.log('done. indexes:');
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
