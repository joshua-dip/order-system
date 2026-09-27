/** Read-only snapshot through the existing review service; answers stay hidden. */
import fs from 'node:fs';
import { config } from 'dotenv';
import { listPendingReviewItems } from '../../lib/generated-question-review-cc';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: '.env' });
config({ path: '.env.local' });
async function main() {
  const [textbook, output] = process.argv.slice(2);
  if (!textbook || !output) throw new Error('textbook and output path required');
  const result = await listPendingReviewItems({ textbook, limit: 30 });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`Read ${result.items.length} pending questions; no DB changes`);
}
main().then(() => process.exit(0)).catch(() => { console.error('Pending snapshot failed'); process.exit(1); });
