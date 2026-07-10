/**
 * 문법 개념(vip_grammar_concepts) 일괄 upsert. Pro 채팅/에이전트가 작성한 JSON 을 검증·저장만.
 *   npx tsx scripts/import-grammar-concepts.ts --user-id <ObjectId> --json draft.json [--dry-run]
 * JSON: { items: [ { topicKey, title, intro, points:[{term,detail,example?}], tip? } ] }
 * topicKey 는 기존 문제(vip_grammar_problems)에 존재해야 함(과정/대단원/학습주제 승계·검증).
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_CONCEPTS_COLLECTION, normalizeConcept } from '../lib/vip-grammar-concept';
import { GRAMMAR_PROBLEMS_COLLECTION } from '../lib/vip-grammar-problem-bank';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const userIdArg = arg('--user-id');
  const jsonPath = arg('--json');
  if (!userIdArg || !jsonPath) { console.error('필수: --user-id --json'); process.exit(1); }
  const userId = new ObjectId(userIdArg);
  const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const items = (JSON.parse(raw).items ?? []) as Record<string, unknown>[];

  const db = await getDb('gomijoshua');
  const concepts = db.collection(GRAMMAR_CONCEPTS_COLLECTION);
  const problems = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const now = new Date();
  let upserted = 0; const skipped: string[] = [];

  for (const it of items) {
    const topicKey = String(it.topicKey ?? '').trim();
    const c = normalizeConcept({ ...it, topicKey });
    if (!topicKey || !c) { skipped.push(`${topicKey || '(빈 topicKey)'} — 개념 비어있음`); continue; }
    const exists = await problems.findOne({ userId, topicKey }, { projection: { _id: 1 } });
    if (!exists) { skipped.push(`${topicKey} — 문제은행에 없는 진도`); continue; }
    if (!dryRun) {
      await concepts.updateOne(
        { userId, topicKey },
        { $set: { userId, topicKey, title: c.title, intro: c.intro, points: c.points, tip: c.tip ?? '', updatedAt: now } },
        { upsert: true },
      );
    }
    upserted++;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}개념 upsert ${upserted}개${skipped.length ? ` · 건너뜀 ${skipped.length}` : ''}`);
  if (skipped.length) console.log('  ' + skipped.slice(0, 20).join('\n  '));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
