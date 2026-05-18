/**
 * 일회성: audit-content 패치 작업용 샘플 문서 검사
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

async function main() {
  const db = await getDb('gomijoshua');
  const id = process.argv[2] || '6a02f8ba39cf925ad58600d1';
  const doc = await db.collection('essay_exams').findOne({ _id: new ObjectId(id) });
  if (!doc) {
    console.log('not found');
    return;
  }
  console.log('difficulty:', doc.difficulty);
  console.log('folder:', doc.folder);
  console.log('sourceKey:', doc.sourceKey);
  const data: any = doc.data;
  for (const q of data.questions || []) {
    console.log('\n=== Q', q.id, '===');
    console.log('answer.text:', q.answer?.text);
    console.log('conditions:');
    (q.conditions || []).forEach((c: string, i: number) => console.log(`  [${i}] ${c}`));
    console.log('intent_content:', q.answer?.intent_content);
    if (q.bogi) console.log('bogi:', JSON.stringify(q.bogi));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
