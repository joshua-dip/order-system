import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGODB_URI || '';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('lyceum');
  const items = await db.collection('question_type_configs').find({}).sort({ order: 1 }).toArray();
  for (const t of items) {
    console.log('---');
    console.log(`id: ${t.id} | label: ${t.label} | order: ${t.order} | active: ${t.isActive}`);
    if (t.description) console.log(`description: ${t.description}`);
    console.log(`prompt: ${t.prompt}`);
  }
  await client.close();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
