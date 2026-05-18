/** 얇고 빠른 미니 모의고사 기본 01강 08번 주장 — Question 비어있는 문항 검사 */
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
  const passages = db.collection('passages');
  const ps = await passages
    .find({ textbook: { $regex: '얇고 빠른 미니 모의고사' } })
    .project({ textbook: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();
  console.log(`passages matched: ${ps.length}`);
  const target = ps.filter(p => {
    const sk = String(p.source_key ?? '');
    const ch = String(p.chapter ?? '');
    const num = String(p.number ?? '');
    const tb = String(p.textbook ?? '');
    const isBasic = /기본/.test(tb) || /기본/.test(sk);
    const is01 = /01강|L1|레슨1|1강/.test(ch) || /01강|01-08|1-8/.test(sk);
    const is08 = num === '8' || num === '08' || /08/.test(sk);
    return isBasic && (is01 || /01/.test(sk)) && is08;
  });
  console.log(`candidates (basic + 01강 + 08번):`);
  for (const p of target) console.log(JSON.stringify(p));

  const pool = target.length > 0 ? target : ps;
  const col = db.collection('generated_questions');
  for (const p of pool) {
    const docs = await col
      .find({ passage_id: p._id, type: '주장' })
      .project({ status: 1, source: 1, type: 1, question_data: 1 })
      .toArray();
    if (docs.length === 0) continue;
    console.log(`\n=== passage ${String(p._id)} (source_key=${p.source_key}) — 주장 ${docs.length}건 ===`);
    for (const d of docs) {
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const q = String(qd.Question ?? '').trim();
      console.log(JSON.stringify({
        id: String(d._id),
        status: d.status,
        source: d.source,
        hasQuestion: q.length > 0,
        questionPreview: q.length > 0 ? q.slice(0, 80) : '(비어있음)',
      }));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
