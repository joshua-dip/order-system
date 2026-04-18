/**
 * question_data.Answer → question_data.CorrectAnswer 로 복사.
 * variant_save_generated_question으로 저장할 때 Answer 키를 잘못 쓴 문항 일괄 보정.
 *
 *   npx tsx scripts/fix-answer-key-to-correct-answer.ts <id> [id2 ...]
 */
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
  const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    console.error('사용법: npx tsx scripts/fix-answer-key-to-correct-answer.ts <id> [id2 ...]');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  for (const id of ids) {
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      console.log(JSON.stringify({ id, error: '문항 없음' }));
      continue;
    }
    const qd = doc.question_data ?? {};
    const answerVal = qd.Answer;
    if (answerVal === undefined) {
      console.log(JSON.stringify({ id, skipped: 'Answer 필드 없음' }));
      continue;
    }
    const r = await col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          'question_data.CorrectAnswer': String(answerVal),
          updated_at: new Date(),
        },
        $unset: { 'question_data.Answer': '' },
      }
    );
    console.log(
      JSON.stringify({
        id,
        type: doc.type,
        CorrectAnswer: String(answerVal),
        modified: r.modifiedCount === 1,
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
