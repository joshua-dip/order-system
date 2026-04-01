/**
 * 로컬·CI cron용: 부족 변형문제를 Claude API로 채움.
 *
 *   npx tsx scripts/variant-auto-fill.ts --textbook "교재명" [--max 5] [--status all]
 *   npx tsx scripts/variant-auto-fill.ts --order-id <24hex> [--max 3]
 *   npx tsx scripts/variant-auto-fill.ts --order-number BV-20260331-002 [--max 3]
 *
 * 필요: MONGODB_URI, ANTHROPIC_API_KEY (.env / .env.local)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { runVariantAutoFillBatch } from '@/lib/variant-scheduled-batch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        m.set(key, next);
        i++;
      } else {
        m.set(key, 'true');
      }
    }
  }
  return m;
}

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (
    first.endsWith('variant-auto-fill.ts') ||
    first.endsWith('variant-auto-fill.js') ||
    path.basename(first) === 'variant-auto-fill.ts' ||
    path.basename(first) === 'variant-auto-fill.js'
  ) {
    return raw.slice(1);
  }
  return raw;
}

async function main() {
  const flags = parseArgs(argvAfterScript());
  const textbook = (flags.get('textbook') ?? '').trim();
  const orderId = (flags.get('order-id') ?? '').trim();
  const orderNumber = (flags.get('order-number') ?? '').trim();
  const maxRaw = flags.get('max') ?? '3';
  const maxGenerations = parseInt(maxRaw, 10);
  const status = (flags.get('status') ?? 'all').trim();
  const requiredPerType = flags.get('required-per-type') ?? null;

  if (orderId && orderNumber) {
    console.error('--order-id 와 --order-number 는 함께 쓸 수 없습니다.');
    process.exit(1);
  }
  if (!textbook && !orderId && !orderNumber) {
    console.error(
      '사용법: npx tsx scripts/variant-auto-fill.ts --textbook "교재명" [--max 5] [--status all|대기|완료]\n' +
        '    또는: npx tsx scripts/variant-auto-fill.ts --order-id <ObjectId> [--max 3]\n' +
        '    또는: npx tsx scripts/variant-auto-fill.ts --order-number BV-… [--max 3]'
    );
    process.exit(1);
  }

  const result = await runVariantAutoFillBatch({
    textbookParam: textbook,
    orderIdRaw: orderId,
    orderNumberRaw: orderNumber || null,
    maxGenerations: Number.isFinite(maxGenerations) ? maxGenerations : 3,
    questionStatusRaw: status,
    requiredPerTypeRaw: requiredPerType,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
  if (result.failed.length > 0) {
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
