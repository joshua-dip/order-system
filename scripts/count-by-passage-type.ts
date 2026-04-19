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
  const [passageId, type] = process.argv.slice(2);
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const docs = await col.find({ passage_id: new ObjectId(passageId), type }).toArray();
  for (const d of docs) {
    console.log(JSON.stringify({ id: String(d._id), status: d.status, type: d.type }));
  }
  console.log('total:', docs.length);
}
main().catch(e => { console.error(e); process.exit(1); });
