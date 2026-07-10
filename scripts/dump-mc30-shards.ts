/**
 * 진도별 30문항 채우기 — 부족한 객관식만큼 생성하도록 에이전트용 샤드 작업파일 생성.
 * 각 진도에 개념 용어·기존 샘플 문항(중복 회피용)·신규 문항 위치(section 'M', no=maxNo+1..) 포함.
 *   npx tsx scripts/dump-mc30-shards.ts --level 1|2|3 --out <dir> [--per-shard 3]
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '../lib/vip-grammar-problem-bank';
import { GRAMMAR_CONCEPTS_COLLECTION } from '../lib/vip-grammar-concept';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const level = arg('--level');
  const outDir = arg('--out');
  const perShard = Math.max(1, Number(arg('--per-shard', '3')));
  const target = Math.max(1, Number(arg('--target', '30')));
  if (!level || !outDir) { console.error('필수: --level --out'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const 과정 = `중등 영문법 LEVEL ${level}`;
  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);

  const topicKeys = (await col.distinct('topicKey', { 과정 })).sort();
  const items: Record<string, unknown>[] = [];
  for (const tk of topicKeys) {
    const docs = await col.find({ topicKey: tk }).project({ category: 1, 학습주제: 1, source: 1, unit: 1, no: 1, question: 1, options: 1, answer: 1 }).toArray();
    const mc = docs.filter((d) => d.category === '객관식');
    const need = Math.max(0, target - mc.length);
    if (need <= 0) continue;
    const maxNo = docs.reduce((m, d) => Math.max(m, (d.no as number) ?? 0), 0);
    const concept = await db.collection(GRAMMAR_CONCEPTS_COLLECTION).findOne({ topicKey: tk }, { projection: { points: 1 } });
    const conceptTerms = (concept?.points ?? []).map((p: { term?: string }) => p.term).filter(Boolean);
    // 스타일/난이도 참고 + 중복 회피용 기존 객관식 샘플(문항+정답)
    const samples = mc.filter((d) => Array.isArray(d.options)).slice(0, 4).map((d) => ({ q: d.question, options: d.options, answer: d.answer }));
    items.push({
      topicKey: tk,
      title: mc[0]?.학습주제 ?? docs[0]?.학습주제 ?? tk.split(' > ').pop(),
      source: mc[0]?.source ?? docs[0]?.source ?? `자체 제작 LEVEL ${level}`,
      unit: mc[0]?.unit ?? docs[0]?.unit ?? 0,
      conceptTerms,
      need,
      startNo: maxNo + 1,
      section: 'M',
      samples,
    });
  }

  const shards: Record<string, unknown>[][] = [];
  for (let i = 0; i < items.length; i += perShard) shards.push(items.slice(i, i + perShard));
  shards.forEach((s, i) => fs.writeFileSync(path.join(outDir, `m30-L${level}-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify({ items: s }, null, 2)));
  console.log(`LEVEL ${level}: 부족 진도 ${items.length} · 총 추가 ${items.reduce((a, b) => a + (b.need as number), 0)} → 샤드 ${shards.length}개 (진도 ${perShard}/샤드)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
