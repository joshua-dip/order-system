/**
 * 일회성: BV-20260504-001 의 8개 문항 status·count 확인.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

const TEXTBOOK = '2027수능특강 영어(2026)';
const SOURCES = ['11강 04번', '14강 03번', '14강 04번', '15강 01번'];
const TYPE = '삽입-고난도';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  let total = 0;
  let done = 0;
  let pending = 0;
  let mismatch = 0;
  for (const source of SOURCES) {
    const docs = await col
      .find({ textbook: TEXTBOOK, source, type: TYPE })
      .project({ _id: 1, status: 1 })
      .sort({ created_at: 1 })
      .toArray();
    console.log(`[${source}]`);
    for (const d of docs) {
      console.log(`  - ${String(d._id)}  status=${d.status}`);
      total += 1;
      if (d.status === '완료') done += 1;
      else if (d.status === '대기') pending += 1;
      else if (d.status === '검수불일치') mismatch += 1;
    }
  }
  console.log(`\nTOTAL=${total}  완료=${done}  대기=${pending}  검수불일치=${mismatch}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e instanceof Error ? e.message : e);
  process.exit(1);
});
