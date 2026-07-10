/**
 * vip_grammar_problems / vip_writing_problems 의 모든 문서에 category(객관식/주관식/선택형) 부여.
 * - deriveProblemCategory 로 판별. 이미 category 가 있어도 규칙대로 재설정(정합성).
 *   npx tsx scripts/backfill-problem-categories.ts [--dry-run]
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import { getDb } from '../lib/mongodb';
import { deriveProblemCategory } from '../lib/vip-problem-category';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb('gomijoshua');
  for (const col of ['vip_grammar_problems', 'vip_writing_problems']) {
    const docs = await db.collection(col).find({}).project({ type: 1, options: 1, answer: 1, category: 1 }).toArray();
    const ops: { updateOne: { filter: { _id: unknown }; update: { $set: { category: string } } } }[] = [];
    const byCat: Record<string, number> = {};
    let changed = 0;
    for (const d of docs) {
      const cat = deriveProblemCategory(d as Record<string, unknown>);
      byCat[cat] = (byCat[cat] ?? 0) + 1;
      if ((d as Record<string, unknown>).category !== cat) {
        changed++;
        ops.push({ updateOne: { filter: { _id: (d as Record<string, unknown>)._id }, update: { $set: { category: cat } } } });
      }
    }
    console.log(`\n=== ${col} : ${docs.length}개 · 카테고리 ${JSON.stringify(byCat)} · 변경 ${changed}개 ${dryRun ? '(dry-run)' : ''}`);
    if (!dryRun && ops.length) {
      const res = await db.collection(col).bulkWrite(ops as never[]);
      console.log(`  적용: modified ${res.modifiedCount}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
