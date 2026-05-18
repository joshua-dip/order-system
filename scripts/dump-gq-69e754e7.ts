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
  const col = db.collection('generated_questions');
  const d = await col.findOne({ _id: new ObjectId('69e754e7e88d0c419697af87') });
  if (!d) { console.log('NOT FOUND'); return; }
  const top = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === 'question_data' || k === 'paragraph_translation' ? `<${typeof v === 'object' && v ? Object.keys(v as object).length : 0} keys>` : v]));
  console.log('top fields:', JSON.stringify(top, null, 2));
  console.log('question_data keys:', Object.keys((d.question_data ?? {}) as object));
  console.log('full question_data:', JSON.stringify(d.question_data, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
