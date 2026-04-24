import { getDb } from '@/lib/mongodb';
import { SOLBOOK_LESSON_LINKS_COLLECTION } from '@/lib/solbook-lesson-links-store';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection(SOLBOOK_LESSON_LINKS_COLLECTION);

  await col.createIndex({ textbookKey: 1 }, { unique: true, name: 'textbookKey_unique' });

  console.log('solbook_lesson_links 인덱스 생성 완료');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
