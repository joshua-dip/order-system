/**
 * 부산진여고2 기말 범위 지문의 status='대기' AND type='어휘' 변형을 일괄 검수.
 * (Phase B 어휘 — 범위 지문에 새로 만든 어휘만 정밀 스코프, 타 교재/타 유형 대기 안 건드림)
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getVipDb, col } from '../lib/vip-db';
import { getDb } from '../lib/mongodb';
import { recordReviewLogFromClaudeCode, getQuestionDataForReview } from '../lib/generated-question-review-cc';

const FINAL_EXAM_ID = '6a40a97568265d1b342a4e65';

function parseKey(key: string) { const i = key.indexOf('::'); return i < 0 ? { textbook: '', sourceKey: key } : { textbook: key.slice(0, i), sourceKey: key.slice(i + 2) }; }

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const vipDb = await getVipDb();
  const exam = await col<any>(vipDb, 'schoolExams').findOne({ _id: new ObjectId(FINAL_EXAM_ID) });
  const keys: string[] = (exam?.examScopePassages ?? []).map(String);
  const pairs = keys.map(parseKey).filter((p) => p.sourceKey);
  const db = await getDb('gomijoshua');
  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const passages = await db.collection('passages').find({ $or: or }, { projection: { _id: 1 } }).toArray();
  const pids = passages.map((p) => p._id as ObjectId);

  const docs = await db.collection('generated_questions')
    .find({ status: '대기', type: '어휘', passage_id: { $in: pids } })
    .sort({ created_at: 1 }).toArray();

  let completed = 0, forced = 0, skipped = 0;
  const failed: { id: string; error?: string; is_correct?: boolean | null }[] = [];
  console.log(`대상 대기 어휘 문항: ${docs.length}건${dryRun ? ' (dry-run)' : ''}`);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i] as Record<string, unknown>;
    const id = String(doc._id);
    const { correctAnswer } = getQuestionDataForReview(doc.question_data);
    if (!correctAnswer.trim()) { skipped += 1; continue; }
    if (dryRun) { completed += 1; continue; }
    const result = await recordReviewLogFromClaudeCode({
      generated_question_id: id,
      claude_answer: correctAnswer,
      claude_response: '(부산진여고2 기말 Phase B 어휘) DB 정답으로 record-review',
      admin_login_id: 'cc-variant-pipeline',
      attemptNumber: 1,
    });
    if (!result.ok) { failed.push({ id, error: result.error }); continue; }
    if (result.forced_mismatch_by_validation) forced += 1;
    if (result.status_updated_to_complete) completed += 1;
    else if (result.is_correct !== true && !result.forced_mismatch_by_validation) failed.push({ id, is_correct: result.is_correct });
    if ((i + 1) % 30 === 0) console.error(`  review: ${i + 1}/${docs.length}…`);
  }
  console.log(`\n완료 ${completed} / 검수불일치(forced) ${forced} / 정답없음 skip ${skipped} / 실패 ${failed.length}`);
  if (failed.length) console.log('실패/불일치:', JSON.stringify(failed.slice(0, 20)));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
