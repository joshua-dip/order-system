/**
 * 분석지 작성용 원문 덤프 — 교재·회차의 지문을 EN/KO 문장 표로 낸다.
 *   npx tsx scripts/cc-analysis-dump.ts "<교재명>" "<source_key 접두 정규식>"
 * 이미 분석이 90% 이상인 지문은 SKIP 표시로 걸러 준다(재작성 방지).
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { passageAnalyzerProgressFromMain } from '@/lib/passage-analyzer-progress-score';

async function main() {
  const [tb, re] = process.argv.slice(2);
  if (!tb || !re) { console.error('사용: cc-analysis-dump.ts "<교재명>" "<정규식>"'); process.exit(1); }
  const db = await getDb('gomijoshua');
  const ps = await db.collection('passages')
    .find({ textbook: tb, source_key: { $regex: re } })
    .project({ source_key: 1, 'content.sentences_en': 1, 'content.sentences_ko': 1 })
    .sort({ source_key: 1 }).toArray();
  for (const p of ps) {
    const d = await db.collection('passage_analyses')
      .findOne({ fileName: passageAnalysisFileNameForPassageId(String(p._id)) }) as Record<string, any> | null;
    const pct = passageAnalyzerProgressFromMain(d?.passageStates?.main ?? null).percent;
    const c = (p.content ?? {}) as Record<string, string[]>;
    const en = c.sentences_en ?? [], ko = c.sentences_ko ?? [];
    console.log(`\n═══ ${p.source_key} | ${String(p._id)} | ${en.length}문장${pct >= 90 ? ' | ★SKIP(이미 완성)' : ''}`);
    if (pct >= 90) continue;
    en.forEach((s, i) => { console.log(`[${i}] ${s}`); console.log(`    ${ko[i] ?? ''}`); });
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
