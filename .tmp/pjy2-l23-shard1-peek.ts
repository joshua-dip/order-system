import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: '/Users/goshua/next-order/.env.local' });
config({ path: '/Users/goshua/next-order/.env' });
import { getDb } from '/Users/goshua/next-order/lib/mongodb';
async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const [tb, type] of [['공통영어2_YBM박준언','순서'],['공통영어2_YBM박준언','삽입']]) {
    const d = await col.findOne({ textbook: tb, type });
    console.log(JSON.stringify({ source: d?.source, qd: d?.question_data }, null, 1));
  }
  const ids = ['6a6f570be087c2fe78de5ec9','6a6f570be087c2fe78de5eca','6a6f570be087c2fe78de5ecb'];
  const { ObjectId } = await import('mongodb');
  const rows = await col.aggregate([{ $match: { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: ids.map(i=>new ObjectId(i)) } }] } }, { $group: { _id: { p: '$passage_id', t: '$type' }, n: { $sum: 1 } } }]).toArray();
  console.log(JSON.stringify(rows));
  const h = await col.findOne({ textbook: '영어II_YBM박준언', type: '순서-고난도' });
  console.log(JSON.stringify(h?.question_data?.Paragraph));
  process.exit(0);
}
main();
