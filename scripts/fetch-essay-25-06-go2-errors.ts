import path from 'path';
import { config } from 'dotenv';
config({ path: path.join(__dirname, '..', '.env.local') });

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import fs from 'fs';

async function main() {
  const ids: string[] = JSON.parse(fs.readFileSync('/tmp/err-ids.json', 'utf-8'));
  const db = await getDb('gomijoshua');
  const oids = ids.map(id => new ObjectId(id));
  const docs = await db
    .collection('essay_exams')
    .find({ _id: { $in: oids } })
    .toArray();
  const out: Record<string, unknown> = {};
  for (const d of docs) {
    out[String(d._id)] = {
      sourceKey: (d as { sourceKey?: string }).sourceKey,
      difficulty: (d as { difficulty?: string }).difficulty,
      folder: (d as { folder?: string }).folder,
      data: (d as { data?: unknown }).data,
    };
  }
  fs.writeFileSync('/tmp/err-docs.json', JSON.stringify(out, null, 2));
  console.log('fetched', docs.length, 'docs');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
