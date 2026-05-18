/**
 * 일회성: BV-20260504-001 중복 저장된 1차 batch 8개를 정리.
 * 안전 가드: 같은 (textbook, source, type) 조합에서 docs를 created_at 오름차순으로
 * 2개씩 묶어, status=완료 또는 더 최근(2번째 그룹)을 남기고 첫 번째 그룹을 삭제한다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const TEXTBOOK = '2027수능특강 영어(2026)';
const SOURCES = ['11강 04번', '14강 03번', '14강 04번', '15강 01번'];
const TYPE = '삽입-고난도';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let totalDeleted = 0;
  for (const source of SOURCES) {
    const docs = await col
      .find({ textbook: TEXTBOOK, source, type: TYPE })
      .project({ _id: 1, status: 1, created_at: 1 })
      .sort({ created_at: 1 })
      .toArray();
    console.log(`\n[${source}] count=${docs.length}`);
    for (const d of docs) {
      console.log(`  - _id=${String(d._id)}  status=${d.status}  created_at=${d.created_at}`);
    }
    if (docs.length <= 2) {
      console.log('  → keep all (≤2)');
      continue;
    }
    const completed = docs.filter((d) => d.status === '완료');
    const others = docs.filter((d) => d.status !== '완료');
    const keep = new Set<string>();
    for (const d of completed) keep.add(String(d._id));
    for (let i = others.length - 1; i >= 0 && keep.size < 2; i--) {
      keep.add(String(others[i]._id));
    }
    const toDelete = docs.filter((d) => !keep.has(String(d._id)));
    console.log(`  keep: ${[...keep].join(', ')}`);
    console.log(`  delete: ${toDelete.map((d) => String(d._id)).join(', ')}`);
    if (!dryRun && toDelete.length) {
      const r = await col.deleteMany({ _id: { $in: toDelete.map((d) => d._id) } });
      console.log(`  deleted: ${r.deletedCount}`);
      totalDeleted += r.deletedCount ?? 0;
    }
  }
  console.log(`\nTOTAL DELETED: ${totalDeleted}${dryRun ? ' (dry-run)' : ''}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e?.message ?? e);
  process.exit(1);
});
