import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { config } from 'dotenv';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.env.DOTENV_CONFIG_QUIET='true'; config({path:path.join(ROOT,'.env')}); config({path:path.join(ROOT,'.env.local')});
const { listGrammarWorkbooks, getGrammarShortage } = await import('./lib/grammar-workbooks-store');
const TB = '26년 5월 고3 영어모의고사';
const wbs = await listGrammarWorkbooks({ textbook: TB, limit: 200 });
console.log('=== 저장된 워크북', wbs.length, '건 ===');
for (const w of wbs) console.log(`  sk="${w.sourceKey}" | passageId=${(w as any).passageId} | folder=${(w as any).folder} | modes=${JSON.stringify(w.modes)}`);
const sh = await getGrammarShortage({ textbook: TB, requiredModes: ['F','G','H','J'] as any });
console.log('=== shortage 21~24 행 (passage_id 대조) ===');
for (const r of sh.shortage.filter(r => /^(21|22|23|24)/.test(r.number))) {
  console.log(`  ${r.number} | passage_id=${r.passage_id} | source_key="${r.source_key}" | have=${JSON.stringify(r.have_modes)}`);
}
console.log('shortageCount:', sh.shortageCount, '/ passagesTotal:', sh.passagesTotal);
