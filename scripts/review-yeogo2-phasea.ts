/**
 * 부산진여고2 기말 Phase A 신규 변형(데이터없는 9지문) 검수.
 * 해당 9개 passage_id 의 status='대기' 문항만 DB정답 대조 + per-question 검증 → 완료/검수불일치.
 * record-review-bulk 가 textbook 단위라 지금필수(타인 대기 451건)를 건드리는 문제를 피하기 위해 passage 스코프.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { recordReviewLogFromClaudeCode, getQuestionDataForReview } from '../lib/generated-question-review-cc';

const PASSAGE_IDS = [
  '6a40ab918b15230a07f4780a', '6a40ab918b15230a07f4780b',
  '69e2f80472a886137cd849de', '69e2f80472a886137cd849e6',
  '69e27c7f72a886137cd844d9', '69e27c8072a886137cd8457e',
  '69e27c8072a886137cd8453a', '69d4eca372a886137cd83f2b',
  '69d4eca372a886137cd83f2c',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb('gomijoshua');
  const pids = PASSAGE_IDS.map((p) => new ObjectId(p));
  const docs = await db.collection('generated_questions')
    .find({ status: '대기', passage_id: { $in: pids } })
    .sort({ created_at: 1 }).toArray();

  let completed = 0, forced = 0, skipped = 0;
  const failed: { id: string; error?: string; is_correct?: boolean | null }[] = [];
  console.log(`대상 대기 문항: ${docs.length}건${dryRun ? ' (dry-run)' : ''}`);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i] as Record<string, unknown>;
    const id = String(doc._id);
    const { correctAnswer } = getQuestionDataForReview(doc.question_data);
    if (!correctAnswer.trim()) { skipped += 1; continue; }
    if (dryRun) { completed += 1; continue; }
    const result = await recordReviewLogFromClaudeCode({
      generated_question_id: id,
      claude_answer: correctAnswer,
      claude_response: '(부산진여고2 기말 Phase A) DB 정답으로 record-review',
      admin_login_id: 'cc-variant-pipeline',
      attemptNumber: 1,
    });
    if (!result.ok) { failed.push({ id, error: result.error }); continue; }
    if (result.forced_mismatch_by_validation) forced += 1;
    if (result.status_updated_to_complete) completed += 1;
    else if (result.is_correct !== true && !result.forced_mismatch_by_validation) failed.push({ id, is_correct: result.is_correct });
    if ((i + 1) % 25 === 0) console.error(`  review: ${i + 1}/${docs.length}…`);
  }
  console.log(`\n완료 ${completed} / 검수불일치(forced) ${forced} / 정답없음 skip ${skipped} / 실패 ${failed.length}`);
  if (failed.length) console.log('실패/불일치:', JSON.stringify(failed.slice(0, 20)));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
