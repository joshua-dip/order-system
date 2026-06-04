import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { config } from 'dotenv';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.env.DOTENV_CONFIG_QUIET='true'; config({path:path.join(ROOT,'.env')}); config({path:path.join(ROOT,'.env.local')});
const { listGrammarWorkbooks } = await import('./lib/grammar-workbooks-store');
const all = await listGrammarWorkbooks({ limit: 500 });
console.log('=== grammar_workbooks 전체', all.length, '건 ===');
const byTb = new Map<string, string[]>();
for (const w of all) {
  const a = byTb.get(w.textbook) ?? []; a.push(w.sourceKey); byTb.set(w.textbook, a);
}
for (const [tb, sks] of byTb) {
  console.log(`textbook=[${tb}] (len ${tb.length}) — ${sks.length}건: ${sks.slice(0,8).join(' / ')}`);
}
