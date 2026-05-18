/** 24년 3월 고2 영어모의고사 21번 — 4 난도 중복 1세트(가장 최근) 제거 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('essay_exams');
  const rows = await col
    .find({ passageId: '69e63b7f72a886137cd85012' })
    .project({ _id: 1, difficulty: 1, createdAt: 1 })
    .sort({ _id: 1 })
    .toArray();
  console.log('found:', rows.length, rows.map(r => `${String(r._id)}/${String(r.difficulty)}`));
  if (rows.length <= 4) { console.log('no dup (≤4건)'); return; }

  // difficulty 별 가장 오래된 것만 keep, 그 외 삭제.
  const seen = new Set<string>();
  const keep: string[] = [];
  const drop: string[] = [];
  for (const r of rows) {
    const d = String(r.difficulty);
    if (!seen.has(d)) { seen.add(d); keep.push(String(r._id)); }
    else drop.push(String(r._id));
  }
  console.log('keep:', keep);
  console.log('drop:', drop);
  const toDelete = drop.map(id => rows.find(r => String(r._id) === id)!._id);
  const r = await col.deleteMany({ _id: { $in: toDelete } });
  console.log(JSON.stringify({ deleted: r.deletedCount }));
}
main().catch(e => { console.error(e); process.exit(1); });
