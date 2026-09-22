import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';

loadCliEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const IDS = [
  '6aaf56d9423338a6a84fa981',
  '6aaf56d9423338a6a84fa982',
  '6aaf56d9423338a6a84fa983',
  '6aaf56d9423338a6a84fa984',
  '6aaf56d9423338a6a84fa985',
  '6aaf56d9423338a6a84fa986',
].map((id) => new ObjectId(id));

async function main() {
  const db = await getDb('gomijoshua');
  const q = await db.collection('generated_questions').deleteMany({ _id: { $in: IDS } });
  const r = await db
    .collection('generated_question_claude_reviews')
    .deleteMany({ generated_question_id: { $in: IDS } });
  console.log(JSON.stringify({ questionsDeleted: q.deletedCount, reviewsDeleted: r.deletedCount }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
