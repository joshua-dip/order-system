/**
 * 일회성: Claude가 푼 결과를 일괄로 record-review.
 * 입력 파일 형식 (JSON): [{ id, answer, response? }]
 *   answer 는 "①" "②" 등 또는 "1" 등.
 * 사용:  npx tsx scripts/record-pending-batch.ts /tmp/answers.json
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { readFileSync } from 'node:fs';
import { recordReviewLogFromClaudeCode } from '../lib/generated-question-review-cc';

type Item = { id: string; answer: string; response?: string };

async function main() {
  const file = (process.argv[2] || '').trim();
  if (!file) {
    console.error('사용법: tsx scripts/record-pending-batch.ts <answers.json>');
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  const items = JSON.parse(raw) as Item[];
  if (!Array.isArray(items)) {
    console.error('JSON 배열이 필요합니다.');
    process.exit(2);
  }

  const summary = {
    total: items.length,
    completed: 0,
    mismatch: 0,
    notUpdated: 0,
    failed: [] as { id: string; reason: string }[],
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it?.id || !it?.answer) {
      summary.failed.push({ id: String(it?.id ?? '?'), reason: 'id/answer 누락' });
      continue;
    }
    const result = await recordReviewLogFromClaudeCode({
      generated_question_id: it.id,
      claude_answer: it.answer,
      claude_response: it.response ?? '풀이',
      admin_login_id: 'cc-pending-batch',
      attemptNumber: 1,
    });
    if (!result.ok) {
      summary.failed.push({ id: it.id, reason: result.error || 'unknown' });
      continue;
    }
    if (result.status_updated_to_complete) summary.completed++;
    else if (result.status_updated_to_mismatch) summary.mismatch++;
    else summary.notUpdated++;

    const tag = result.status_updated_to_complete
      ? '완료'
      : result.status_updated_to_mismatch
        ? '검수불일치'
        : `is_correct=${result.is_correct}`;
    console.error(`[${i + 1}/${items.length}] ${it.id} → ${tag}`);
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
