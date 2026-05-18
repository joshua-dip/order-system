/**
 * 일회성 정리: 공통영어1_YBM박준언 Lesson 1 2번 (양정고1 직보) 중복 저장된
 * 더 오래된 essay_exams 1건 삭제. 가장 최근 createdAt 의 것만 남긴다.
 *
 * 사용: npx tsx scripts/delete-duplicate-essay-l1-2.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const PASSAGE_ID = '69da7bc972a886137cd84156';
const FOLDER = '양정고1 직보';

async function main() {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('essay_exams')
    .find({ passageId: PASSAGE_ID, folder: FOLDER })
    .project({ _id: 1, createdAt: 1, title: 1 })
    .sort({ createdAt: 1 })
    .toArray();

  console.log('found', docs.length, '문서:');
  for (const d of docs) console.log(' -', String(d._id), d.createdAt, d.title);

  if (docs.length <= 1) {
    console.log('[skip] 중복 없음');
    process.exit(0);
  }
  const olderIds = docs.slice(0, -1).map(d => d._id);
  const r = await db.collection('essay_exams').deleteMany({ _id: { $in: olderIds } });
  console.log('[after] deletedCount =', r.deletedCount, '— 최신 1건만 유지');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
