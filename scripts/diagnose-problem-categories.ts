/**
 * 진단(읽기 전용) — vip_grammar_problems / vip_writing_problems 의 타입·형식 분포.
 * 카테고리화(객관식/주관식/선택형) 설계를 위한 현황 파악용.
 *   npx tsx scripts/diagnose-problem-categories.ts
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import { getDb } from '../lib/mongodb';

function bucket(d: Record<string, unknown>): string {
  const options = Array.isArray(d.options) ? (d.options as unknown[]).length : 0;
  const type = String(d.type ?? '');
  const answer = String(d.answer ?? '');
  const isCircled = /^[①②③④⑤]$/.test(answer.trim());
  if (type === '선택형') return '선택형';
  if (options >= 3 || isCircled) return '객관식';
  return '주관식';
}

async function main() {
  const db = await getDb('gomijoshua');
  for (const col of ['vip_grammar_problems', 'vip_writing_problems']) {
    const docs = await db.collection(col).find({}).project({ type: 1, options: 1, answer: 1, subjective: 1, topicKey: 1 }).toArray();
    const byCat: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const withSubj = { yes: 0, no: 0 };
    const 선택형Topics = new Set<string>();
    for (const d of docs) {
      const cat = bucket(d as Record<string, unknown>);
      byCat[cat] = (byCat[cat] ?? 0) + 1;
      const t = String((d as Record<string, unknown>).type ?? '(빈)');
      byType[t] = (byType[t] ?? 0) + 1;
      if ((d as Record<string, unknown>).subjective) withSubj.yes++; else withSubj.no++;
      if (cat === '선택형') 선택형Topics.add(String((d as Record<string, unknown>).topicKey ?? ''));
    }
    console.log(`\n=== ${col} : 총 ${docs.length}개 ===`);
    console.log('카테고리(파생):', byCat);
    console.log('type 필드:', byType);
    console.log('subjective 원형 보유:', withSubj);
    if (선택형Topics.size) {
      console.log(`선택형이 있는 진도 ${선택형Topics.size}개:`);
      for (const t of [...선택형Topics].sort()) console.log('  -', t);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
