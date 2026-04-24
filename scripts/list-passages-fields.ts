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
  const ids = process.argv.slice(2);
  const db = await getDb('gomijoshua');
  const col = db.collection('passages');
  for (const id of ids) {
    const p = await col.findOne({ _id: new ObjectId(id) }, { projection: { textbook: 1, number: 1, source_key: 1, chapter: 1 } });
    console.log(JSON.stringify({ id, ...p }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
