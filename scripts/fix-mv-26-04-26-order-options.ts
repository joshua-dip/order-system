/**
 * MV-20260426-001 주문의 24개 순서 문항의 question_data.Options 를
 * `### ` 단일 라인 → 5줄 newline 형식으로 정규화.
 *
 * order-options 검증기는 newline 분리만 인정 (5개 라인 필요).
 *
 * 사용: npx tsx scripts/fix-mv-26-04-26-order-options.ts
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

const ORDER_IDS = [
  '69ed8f07f451f9243bc2b74a', '69ed8f12f451f9243bc2b74b', // 20번
  '69ed8f9ef451f9243bc2b74e', '69ed8facf451f9243bc2b74f', // 29번
  '69ed8ff4f451f9243bc2b752', '69ed8ffef451f9243bc2b753', // 30번
  '69ed9047f451f9243bc2b756', '69ed9053f451f9243bc2b757', // 32번
  '69ed9090f451f9243bc2b75a', '69ed9099f451f9243bc2b75b', // 33번
  '69ed90d1f451f9243bc2b75e', '69ed90daf451f9243bc2b75f', // 34번
  '69ed9122f451f9243bc2b762', '69ed912af451f9243bc2b763', // 35번
  '69ed9162f451f9243bc2b766', '69ed916cf451f9243bc2b767', // 36번
  '69ed91a4f451f9243bc2b76a', '69ed91aef451f9243bc2b76b', // 37번
  '69ed91e8f451f9243bc2b76e', '69ed91f1f451f9243bc2b76f', // 38번
  '69ed9229f451f9243bc2b772', '69ed9238f451f9243bc2b773', // 39번
  '69ed9275f451f9243bc2b776', '69ed9282f451f9243bc2b777', // 40번
];

const CORRECT_OPTIONS = [
  '① (A)-(C)-(B)',
  '② (B)-(A)-(C)',
  '③ (B)-(C)-(A)',
  '④ (C)-(A)-(B)',
  '⑤ (C)-(B)-(A)',
].join('\n');

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let updated = 0;
  let skipped = 0;
  for (const id of ORDER_IDS) {
    const _id = new ObjectId(id);
    const doc = await col.findOne({ _id });
    if (!doc) {
      console.log(`SKIP (not found): ${id}`);
      skipped++;
      continue;
    }
    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const before = qd.Options;
    const next = { ...qd, Options: CORRECT_OPTIONS };
    await col.updateOne({ _id }, { $set: { question_data: next, updated_at: new Date() } });
    updated++;
    console.log(`OK ${id}  (was: ${typeof before === 'string' ? before.slice(0, 60) : JSON.stringify(before).slice(0, 60)}...)`);
  }
  console.log(`\nDONE  updated=${updated}  skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
