/** 문항 ID들의 status를 '검수불일치'로 변경 */
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
  const ids = process.argv.slice(2).filter(Boolean);
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const id of ids) {
    const r = await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: '검수불일치', updated_at: new Date() } }
    );
    console.log(JSON.stringify({ id, modified: r.modifiedCount === 1 }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
