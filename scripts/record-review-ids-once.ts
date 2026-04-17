/**
 * 일회성: 여러 generated_question_id에 대해 record-review 동일 옵션으로 연속 호출.
 * 사용: npx tsx scripts/record-review-ids-once.ts <id1> <id2> ...
 */
import path from 'path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { recordReviewLogFromClaudeCode } from '@/lib/generated-question-review-cc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

const ids = process.argv.slice(2).filter(Boolean);
const answer = '①';
const response = '검수 후 완료 처리(사용자 요청)';

async function main() {
  if (ids.length === 0) {
    console.error('사용: npx tsx scripts/record-review-ids-once.ts <ObjectId> ...');
    process.exit(1);
  }
  for (const id of ids) {
    const out = await recordReviewLogFromClaudeCode({
      generated_question_id: id,
      claude_answer: answer,
      claude_response: response,
      admin_login_id: 'cc-variant-ids-once',
      attemptNumber: 1,
    });
    console.log(JSON.stringify(out));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
