import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig();
import { getDb } from '../lib/mongodb';

async function main() {
  const db = await getDb('gomijoshua');
  // 하나의 전체 문서
  const anyDoc = await db.collection('narrative_questions').findOne({});
  console.log('--- anyDoc (keys) ---');
  console.log(Object.keys(anyDoc || {}));
  console.log('--- anyDoc (full) ---');
  console.log(JSON.stringify(anyDoc, null, 2).slice(0, 3000));

  // narrative_subtype 분포
  const subtypes = await db.collection('narrative_questions').aggregate([
    { $group: { _id: '$narrative_subtype', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray();
  console.log('--- narrative_subtype counts ---');
  console.log(JSON.stringify(subtypes, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
