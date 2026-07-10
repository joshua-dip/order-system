/**
 * 문법 문제은행의 모든 진도(topicKey)를 개념 미보유분만 골라 에이전트용 샤드로 덤프.
 * 각 항목에 과정/대단원/학습주제 + 샘플 문제 2개(개념 타깃팅용) 포함.
 *   npx tsx scripts/dump-concept-topics.ts --out <dir> [--shards 6]
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION } from '../lib/vip-grammar-problem-bank';
import { GRAMMAR_CONCEPTS_COLLECTION } from '../lib/vip-grammar-concept';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const outDir = arg('--out');
  const shards = Math.max(1, Number(arg('--shards', '6')));
  if (!outDir) { console.error('필수: --out'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const rows = await col.aggregate([
    { $group: { _id: '$topicKey', 과정: { $first: '$과정' }, 대단원: { $first: '$대단원' }, 학습주제: { $first: '$학습주제' }, unit: { $first: '$unit' }, qs: { $push: '$question' } } },
    { $sort: { 과정: 1, unit: 1 } },
  ]).toArray();

  const haveConcept = new Set((await db.collection(GRAMMAR_CONCEPTS_COLLECTION).distinct('topicKey')) as string[]);
  const topics = rows
    .filter((r) => !haveConcept.has(String(r._id)))
    .map((r) => ({
      topicKey: String(r._id),
      과정: r.과정, 대단원: r.대단원, 학습주제: r.학습주제,
      samples: (r.qs as string[]).slice(0, 3),
    }));

  const shardArr: typeof topics[] = Array.from({ length: shards }, () => []);
  topics.forEach((t, i) => shardArr[i % shards].push(t));

  let total = 0;
  shardArr.forEach((items, i) => {
    total += items.length;
    fs.writeFileSync(path.join(outDir, `ctask-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify({ shard: i + 1, count: items.length, items }, null, 2));
  });
  console.log(`개념 미보유 진도 ${topics.length}개 → 샤드 ${shards}개 (총 ${total}) → ${outDir}`);
  shardArr.forEach((items, i) => console.log(`  ctask-${String(i + 1).padStart(2, '0')}.json : ${items.length}`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
