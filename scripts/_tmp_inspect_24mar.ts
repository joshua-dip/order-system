import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import 'dotenv/config';

(async () => {
  const db = await getDb('gomijoshua');
  const ids = [
    '6a04a3ac0f2ac5a75a05e7ae',
    '6a04ae08148a3a85acc53a42',
    '6a04a06f44811dfd6367c2cb',
  ];
  for (const id of ids) {
    const doc = await db.collection('essay_exams').findOne({ _id: new ObjectId(id) });
    console.log('===', id, doc?.difficulty, doc?.sourceKey);
    const qs = doc?.data?.questions || [];
    for (const q of qs) {
      console.log('--- Q', q.id, '---');
      console.log('  answer.text:', q.answer?.text);
      const conds = q.conditions || [];
      for (let i = 0; i < conds.length; i++) {
        console.log(`  conditions[${i}]: ${JSON.stringify(conds[i])}`);
      }
    }
  }
  process.exit(0);
})();
