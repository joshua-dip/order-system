/**
 * 일회성: generated_questions에서 _id 하나를 삭제.
 * 사용: npx tsx scripts/delete-generated-question.ts <_id>
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

async function main() {
  const id = process.argv[2];
  if (!id || !ObjectId.isValid(id)) {
    console.error('usage: tsx scripts/delete-generated-question.ts <ObjectId>');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const before = await db
    .collection('generated_questions')
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { textbook: 1, source: 1, type: 1, status: 1 } }
    );
  console.log('before:', JSON.stringify(before));
  if (!before) {
    console.log('not found, nothing to delete');
    process.exit(0);
  }
  const r = await db.collection('generated_questions').deleteOne({ _id: new ObjectId(id) });
  console.log('deleteOne:', JSON.stringify(r));
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e?.message ?? e);
  process.exit(1);
});
