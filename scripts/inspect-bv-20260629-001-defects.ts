/** 일회용 read-only: BV-20260629-001 검수 결함 2건 상세 덤프 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

const IDS = ['69c027ea5f2026cf9265dacb', '69c4248893957bcf0156f0fa'];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const id of IDS) {
    const d = await col.findOne({ _id: new ObjectId(id) });
    if (!d) { console.log(`\n[${id}] 없음`); continue; }
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    console.log('\n=============================================');
    console.log(`_id=${id}  type=${d.type}  source=${d.source}  status=${d.status}  option_type=${d.option_type ?? ''}`);
    console.log('--- Paragraph ---');
    console.log(qd.Paragraph ?? '(없음)');
    console.log('--- Options ---');
    console.log(qd.Options ?? '(없음)');
    console.log('--- CorrectAnswer ---');
    console.log(qd.CorrectAnswer ?? '(없음)');
    console.log('--- Explanation ---');
    console.log(qd.Explanation ?? '(없음)');
    // 지문 원문
    const pid = d.passage_id;
    const oid = pid instanceof ObjectId ? pid : (typeof pid === 'string' && ObjectId.isValid(pid) ? new ObjectId(pid) : null);
    if (oid) {
      const p = await db.collection('passages').findOne({ _id: oid }, { projection: { 'content.original': 1, source_key: 1 } });
      const orig = (p?.content as Record<string, unknown> | undefined)?.original;
      console.log('--- 지문 원문 ---');
      console.log(typeof orig === 'string' ? orig : '(원문 없음)');
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
