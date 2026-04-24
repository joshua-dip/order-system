/** BV-20260421-001의 5회 01·02번 삽입 문항 상태 확인 */
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
  const ids = ['69e74c7c75254d46b7793f1a', '69e74c8775254d46b7793f1c'];
  for (const id of ids) {
    const d = await col.findOne({ _id: new ObjectId(id) });
    if (!d) { console.log(id, '없음'); continue; }
    console.log(JSON.stringify({
      id,
      type: d.type,
      status: d.status,
      textbook: d.textbook,
      source: d.source,
      passage_id: String(d.passage_id),
    }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
