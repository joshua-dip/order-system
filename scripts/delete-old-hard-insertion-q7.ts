/**
 * 01강 04번 삽입-고난도 Q7 (지문과 의미가 너무 가까운 브리지) 1건 삭제.
 * 교체본은 이미 `69ede1947457f3a995c0cfed` 로 저장됨.
 *
 * 사용: npx tsx scripts/delete-old-hard-insertion-q7.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const TARGET_ID = '69eddcdb7457f3a995c0cfcd';

async function main() {
  const db = await getDb('gomijoshua');
  const _id = new ObjectId(TARGET_ID);

  const doc = await db.collection('generated_questions').findOne(
    { _id },
    { projection: { textbook: 1, source: 1, type: 1, status: 1 } },
  );
  if (!doc) {
    console.log(`[skip] _id=${TARGET_ID} 없음`);
    process.exit(0);
  }
  console.log('[before]', doc);

  const r = await db.collection('generated_questions').deleteOne({ _id });
  console.log('[after] deletedCount =', r.deletedCount);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
