/**
 * 고1/고2 영어모의고사 교재를 해당 폴더로 일괄 지정.
 * 사용: npx tsx scripts/assign-mocktest-folders.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const FOLDER_ID_GO1 = '69c900201edf46e340e42a60'; // 고1 영어모의고사
const FOLDER_ID_GO2 = '69c9005f1edf46e340e42a62'; // 고2 영어모의고사
const FOLDER_ID_GO3 = '69c9007a1edf46e340e42a63'; // 고3 영어모의고사

async function main() {
  const db = await getDb('gomijoshua');
  const passagesCol = db.collection('passages');
  const assignCol = db.collection('textbook_link_folder_assignments');

  const [go1Textbooks, go2Textbooks, go3Textbooks] = await Promise.all([
    passagesCol.distinct('textbook', { textbook: { $regex: '고1 영어모의고사$' } }),
    passagesCol.distinct('textbook', { textbook: { $regex: '고2 영어모의고사$' } }),
    passagesCol.distinct('textbook', { textbook: { $regex: '고3 영어모의고사$' } }),
  ]);

  console.log(`고1 영어모의고사: ${go1Textbooks.length}개`);
  console.log(`고2 영어모의고사: ${go2Textbooks.length}개`);
  console.log(`고3 영어모의고사: ${go3Textbooks.length}개\n`);

  const now = new Date();
  let changed = 0, same = 0;

  for (const [keys, folderId, label] of [
    [go1Textbooks, FOLDER_ID_GO1, '고1 영어모의고사'],
    [go2Textbooks, FOLDER_ID_GO2, '고2 영어모의고사'],
    [go3Textbooks, FOLDER_ID_GO3, '고3 영어모의고사'],
  ] as [string[], string, string][]) {
    for (const textbookKey of keys as string[]) {
      const r = await assignCol.updateOne(
        { textbookKey },
        { $set: { textbookKey, folderId, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      if (r.upsertedCount || r.modifiedCount) {
        console.log(`  ➕ [${label}] "${textbookKey}"`);
        changed++;
      } else {
        same++;
      }
    }
  }

  console.log(`\n✅ 완료 — 신규/변경 ${changed}개, 기존 동일 ${same}개`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
