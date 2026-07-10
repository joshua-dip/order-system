/**
 * 문법 개념에 표(격변화·동사변화 등 사실 데이터)를 추가/갱신. 기존 intro·points·tip 은 유지.
 *   npx tsx scripts/set-concept-table.ts --user-id <ObjectId> --json tables.json [--dry-run]
 * JSON: { items: [ { topicKey, table: { title?, headers:[], rows:[[]] } } ] }
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_CONCEPTS_COLLECTION } from '../lib/vip-grammar-concept';

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
  const items = (JSON.parse(fs.readFileSync(jsonPath, 'utf8')).items ?? []) as { topicKey: string; table: { title?: string; headers: string[]; rows: string[][] } }[];

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_CONCEPTS_COLLECTION);
  let updated = 0; const skipped: string[] = [];
  for (const it of items) {
    const tk = String(it.topicKey ?? '').trim();
    const t = it.table;
    if (!tk || !t || !Array.isArray(t.headers) || !Array.isArray(t.rows) || !t.headers.length || !t.rows.length) { skipped.push(`${tk || '(빈)'} — table 부실`); continue; }
    const existing = await col.findOne({ userId, topicKey: tk }, { projection: { _id: 1 } });
    if (!existing) { skipped.push(`${tk} — 개념 없음`); continue; }
    if (!dryRun) await col.updateOne({ userId, topicKey: tk }, { $set: { table: t, updatedAt: new Date() } });
    updated++;
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}표 설정 ${updated}개${skipped.length ? ` · 건너뜀 ${skipped.length}` : ''}`);
  if (skipped.length) console.log('  ' + skipped.join('\n  '));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
