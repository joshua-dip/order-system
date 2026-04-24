/** BV-20260421-001 삽입 2건의 difficulty: 상 → 중 (삽입-고난도 재분류 회피) */
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
  const ids = ['69e74c8275254d46b7793f1b', '69e74c8d75254d46b7793f1d'];
  for (const id of ids) {
    const r = await col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          difficulty: '중',
          'question_data.DifficultyLevel': '중',
          updated_at: new Date(),
        },
      }
    );
    console.log(JSON.stringify({ id, matched: r.matchedCount, modified: r.modifiedCount }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
