/** 01강 01번 "직전보강 서술형 파이널" 중복 1건 제거 */
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
  const db = await getDb('gomijoshua');
  const col = db.collection('essay_exams');
  const rows = await col
    .find({ passageId: '69d4eca372a886137cd83ecd' })
    .project({ _id: 1, title: 1, createdAt: 1 })
    .sort({ _id: 1 })
    .toArray();
  console.log('found:', rows.map(r => String(r._id)));
  if (rows.length < 2) { console.log('no dup'); return; }
  const keep = rows[0];
  const dup = rows[rows.length - 1];
  console.log('keep:', String(keep._id), 'delete:', String(dup._id));
  const r = await col.deleteOne({ _id: dup._id });
  console.log(JSON.stringify({ deleted: r.deletedCount }));
}
main().catch(e => { console.error(e); process.exit(1); });
