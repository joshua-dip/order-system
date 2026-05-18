/** 얇고 빠른 미니 모의고사 기본 01강 08번 주장 — 비어있는 Question 채우기 */
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

async function main() {
  const id = '69e754e7e88d0c419697af87';
  const QUESTION = '이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?';
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const before = await col.findOne({ _id: new ObjectId(id) }, { projection: { 'question_data.Question': 1, type: 1, source: 1, status: 1 } });
  console.log('before:', JSON.stringify(before));
  const res = await col.updateOne(
    { _id: new ObjectId(id) },
    { $set: { 'question_data.Question': QUESTION, updated_at: new Date() } },
  );
  console.log('updateResult:', JSON.stringify({ matched: res.matchedCount, modified: res.modifiedCount }));
  const after = await col.findOne({ _id: new ObjectId(id) }, { projection: { 'question_data.Question': 1 } });
  console.log('after:', JSON.stringify(after));
}
main().catch(e => { console.error(e); process.exit(1); });
