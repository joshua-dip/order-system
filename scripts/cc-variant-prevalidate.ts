/**
 * 저장 전 오프라인 검증 — cc:variant save 에 넣을 JSON(배열)을 insert 없이 검증.
 * checkContentIntegrity + runPerQuestionValidations 를 그대로 돌려 error/warning 을 항목별 보고.
 * 사용: npx tsx scripts/cc-variant-prevalidate.ts <draft.json>
 */
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { getDb } from '../lib/mongodb';
import { checkContentIntegrity } from '../lib/content-integrity-validation';
import { runPerQuestionValidations } from '../lib/variant-review-validators';

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('사용법: tsx scripts/cc-variant-prevalidate.ts <draft.json>'); process.exit(1); }
  const raw = fs.readFileSync(path.isAbsolute(file) ? file : path.join(process.cwd(), file), 'utf8');
  const body = JSON.parse(raw);
  const items: any[] = Array.isArray(body) ? body : [body];
  const db = await getDb('gomijoshua');

  let totalErr = 0, totalWarn = 0;
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    const doc = { type: o.type, passage_id: o.passage_id, question_data: o.question_data };
    const ci = checkContentIntegrity(doc);
    const pq = await runPerQuestionValidations(db, doc);
    const all = [...ci, ...pq];
    const errs = all.filter((x) => x.severity === 'error');
    const warns = all.filter((x) => x.severity === 'warning');
    totalErr += errs.length; totalWarn += warns.length;
    const tag = errs.length ? '❌' : warns.length ? '⚠️ ' : '✅';
    console.log(`${tag} [${i + 1}] ${o.type}  (정답 ${o.question_data?.CorrectAnswer ?? '?'})`);
    for (const e of errs) console.log(`      ERROR  ${e.rule}: ${e.message}`);
    for (const w of warns) console.log(`      warn   ${w.rule}: ${w.message}`);
  }
  console.log(`\n합계: ${items.length}문항  ERROR=${totalErr}  warning=${totalWarn}`);
  process.exit(totalErr > 0 ? 2 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
