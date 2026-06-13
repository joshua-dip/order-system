import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { runPerQuestionValidations } from '@/lib/variant-review-validators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const IDS = ['69c5023aba1cb2cd5afe3626', '69c5023aba1cb2cd5afe3620'];
const STD = '① ### ② ### ③ ### ④ ### ⑤';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const id of IDS) {
    const d = await col.findOne({ _id: new ObjectId(id) });
    const qd = (d?.question_data ?? {}) as Record<string, unknown>;
    if (!d || d.type !== '어법' || !/^[①②③④⑤\s\n]+$/.test(String(qd.Options ?? ''))) {
      console.log('SKIP', id, '사전조건 불일치'); continue;
    }
    if (APPLY) await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': STD, updated_at: new Date() } });
    // 검증 재확인
    const after = await col.findOne({ _id: d._id });
    const issues = (await runPerQuestionValidations(db, after as Record<string, unknown>)).filter((i) => i.severity === 'error');
    console.log(`${APPLY ? 'APPLIED' : 'DRY'} ${id} CA=${qd.CorrectAnswer} → error 후 ${issues.length}건`, issues.map((i) => i.rule));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
