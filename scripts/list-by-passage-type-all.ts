/** passage_id + type 조건으로 모든 문항 나열 (status, source) */
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
  const args = process.argv.slice(2);
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (let i = 0; i < args.length; i += 2) {
    const passageId = args[i];
    const type = args[i + 1];
    console.log(`--- ${passageId} ${type} ---`);
    const docs = await col.find({ passage_id: new ObjectId(passageId), type }).toArray();
    for (const d of docs) {
      console.log(JSON.stringify({ id: String(d._id), status: d.status, source: d.source, option_type: d.option_type }));
    }
    if (docs.length === 0) console.log('(none)');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
