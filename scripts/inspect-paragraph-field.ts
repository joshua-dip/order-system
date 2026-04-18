/**
 * 38개 문항의 question_data 필드 현황 출력
 * npx tsx scripts/inspect-paragraph-field.ts <id> [id2 ...]
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
    console.error('사용법: npx tsx scripts/inspect-paragraph-field.ts <id> [id2 ...]');
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
    const keys = Object.keys(qd);
    const hasParagraph = 'Paragraph' in qd && String(qd.Paragraph ?? '').trim().length > 0;
    const alternateKeys = keys.filter(k => !['Question','Options','OptionType','CorrectAnswer','Explanation','Source','NumQuestion','Category','DifficultyLevel','Paragraph'].includes(k));
    console.log(JSON.stringify({
      id,
      type: doc.type,
      hasParagraph,
      paragraphLen: hasParagraph ? String(qd.Paragraph).length : 0,
      keys,
      alternateKeys,
    }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
