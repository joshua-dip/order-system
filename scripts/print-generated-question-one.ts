/** 일회 조회: npx tsx scripts/print-generated-question-one.ts [ObjectId] */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env.local') });

const idArg = process.argv[2] ?? '69e092adee8cc64be30c59fb';

void (async () => {
  const db = await getDb('gomijoshua');
  const doc = await db.collection('generated_questions').findOne({ _id: new ObjectId(idArg) });
  if (!doc) {
    console.error('not found:', idArg);
    process.exit(1);
  }
  const out = {
    ...doc,
    _id: String(doc._id),
    passage_id: doc.passage_id != null ? String(doc.passage_id) : doc.passage_id,
    created_at:
      doc.created_at instanceof Date ? doc.created_at.toISOString() : doc.created_at,
    updated_at:
      doc.updated_at instanceof Date ? doc.updated_at.toISOString() : doc.updated_at,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
