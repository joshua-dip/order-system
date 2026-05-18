/**
 * 일회성 정리: Booster 구문독해 CHAPTER 05 형용사적 수식어구의 이해 3번
 * (passageId=69f1ab35b98f450c9f8edaa7, folder=기본) 중복 저장된 가장 오래된 1건 삭제.
 *
 * 사용: npx tsx scripts/delete-duplicate-essay-ch05-3.ts
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

const PASSAGE_ID = '69f1ab35b98f450c9f8edaa7';
const FOLDER = '기본';

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
