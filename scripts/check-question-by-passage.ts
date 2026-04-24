/** passage_id의 모든 완료 문항에서 Question 필드 존재 여부 점검 */
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
  const passageId = process.argv[2];
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const docs = await col.find({ passage_id: new ObjectId(passageId), status: '완료' }).toArray();
  console.log(`총 완료 문항: ${docs.length}`);
  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const q = String(qd.Question ?? '').trim();
    const hasQ = q.length > 0;
    console.log(JSON.stringify({
      id: String(d._id),
      type: d.type,
      source: d.source,
      hasQuestion: hasQ,
      questionPreview: hasQ ? q.slice(0, 60) : '(비어있음)',
    }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
