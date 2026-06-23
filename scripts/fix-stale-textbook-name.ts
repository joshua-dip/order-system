/**
 * 회원 허용목록의 stale 교재명을 현행 이름으로 치환 (예: (2024) → (2026)).
 * 기본은 dry-run(미리보기). 실제 반영은 --apply.
 *
 * 실행:
 *   npx tsx scripts/fix-stale-textbook-name.ts --from "지금필수 고난도유형(2024)" --to "지금필수 고난도유형(2026)"
 *   npx tsx scripts/fix-stale-textbook-name.ts --from "..." --to "..." --apply
 *
 * 대상 필드(회원별 배열): allowedTextbooksVariant / allowedTextbooks /
 *   allowedTextbooksWorkbook / allowedTextbooksEssay.
 * - from 만 있는 doc: 원소를 to 로 치환.
 * - from·to 둘 다 있는 doc: from 만 제거(중복 방지).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

const FIELDS = [
  'allowedTextbooksVariant',
  'allowedTextbooks',
  'allowedTextbooksWorkbook',
  'allowedTextbooksEssay',
];

async function main() {
  const from = getFlag('from').trim();
  const to = getFlag('to').trim();
  const apply = hasFlag('apply');
  if (!from || !to) {
    console.error('사용법: --from "옛 교재명" --to "새 교재명" [--apply]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const users = db.collection('users');

  const plan: Record<string, { rename: number; dedupPull: number }> = {};
  for (const f of FIELDS) {
    const renameCount = await users.countDocuments({ [f]: from, $nor: [{ [f]: to }] });
    const dedupCount = await users.countDocuments({ $and: [{ [f]: from }, { [f]: to }] });
    plan[f] = { rename: renameCount, dedupPull: dedupCount };
  }

  console.log(JSON.stringify({ from, to, mode: apply ? 'APPLY' : 'DRY-RUN', plan }, null, 2));

  if (!apply) {
    console.log('\n(미리보기) 실제 반영하려면 --apply 를 붙여 다시 실행하세요.');
    process.exit(0);
  }

  const result: Record<string, { renamed: number; deduped: number }> = {};
  for (const f of FIELDS) {
    // from·to 둘 다 있는 doc: from 제거(중복 방지)
    const dedup = await users.updateMany(
      { $and: [{ [f]: from }, { [f]: to }] },
      { $pull: { [f]: from } } as Record<string, unknown>,
    );
    // from 만 있는 doc: 원소 치환
    const ren = await users.updateMany(
      { [f]: from },
      { $set: { [`${f}.$[e]`]: to } },
      { arrayFilters: [{ e: from }] },
    );
    result[f] = { renamed: ren.modifiedCount, deduped: dedup.modifiedCount };
  }
  console.log('\n반영 완료:');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
