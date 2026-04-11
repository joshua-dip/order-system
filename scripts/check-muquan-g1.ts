import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';

async function main() {
  const db = await getDb('gomijoshua');
  const count = await db.collection('generated_questions').countDocuments({
    textbook: '26년 3월 고1 영어모의고사',
    type: '무관한문장'
  });
  const bySource = await db.collection('generated_questions').aggregate([
    { $match: { textbook: '26년 3월 고1 영어모의고사', type: '무관한문장' } },
    { $group: { _id: '$source', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log('총 무관한문장 수:', count);
  bySource.forEach((r: any) => console.log(` ${r._id}: ${r.count}건`));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
