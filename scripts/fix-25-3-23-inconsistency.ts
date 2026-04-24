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
  const id = new ObjectId('69c8d569e2cce1edd505bba5');

  const newOptions =
    '① The brain uses a two-tier memory system when retrieving memories. ' +
    '### ② People may recognize someone without remembering the person’s name. ' +
    '### ③ Recall refers to having only a vague sense of familiarity. ' +
    '### ④ Recognition indicates that a memory exists. ' +
    '### ⑤ Recall involves accessing the original memory of how and why you know someone.';

  const r = await col.updateOne(
    { _id: id },
    {
      $set: {
        type: '불일치',
        'question_data.Category': '불일치',
        'question_data.Question': '다음 글의 내용과 일치하지 않는 것은?',
        'question_data.Options': newOptions,
        updated_at: new Date(),
      },
    }
  );
  console.log(JSON.stringify({ id: String(id), modified: r.modifiedCount === 1 }));
}

main().catch(e => { console.error(e); process.exit(1); });
