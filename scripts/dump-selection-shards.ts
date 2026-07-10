/**
 * 선택형(2지선다) 515문항을 진도별로 덤프 → 에이전트용 샤드 작업파일 생성.
 * 각 선택형에 대응할 객관식의 위치(section='E', no=진도 max no+누적)를 미리 배정(충돌 방지).
 *   npx tsx scripts/dump-selection-shards.ts --out <dir> [--shards 10]
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '../lib/vip-grammar-problem-bank';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const outDir = arg('--out');
  const shards = Math.max(1, Number(arg('--shards', '10')));
  if (!outDir) { console.error('필수: --out <dir>'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const sel = await col.find({ category: '선택형' })
    .project({ serialNo: 1, topicKey: 1, 과정: 1, 대단원: 1, 학습주제: 1, unit: 1, section: 1, no: 1, question: 1, answer: 1 })
    .sort({ topicKey: 1, unit: 1, no: 1 }).toArray();

  // 진도별 max no (객관식 새 번호 배정용)
  const maxNoByTopic: Record<string, number> = {};
  const maxRows = await col.aggregate([{ $group: { _id: '$topicKey', maxNo: { $max: '$no' } } }]).toArray();
  for (const r of maxRows) maxNoByTopic[String(r._id)] = (r.maxNo as number) ?? 0;

  // 진도별 그룹 → 각 선택형에 새 no 배정
  const byTopic = new Map<string, Record<string, unknown>[]>();
  for (const d of sel) {
    const t = String(d.topicKey);
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t)!.push(d as Record<string, unknown>);
  }
  const topics = [...byTopic.keys()];

  // 라운드로빈 샤드
  const shardItems: Record<string, unknown>[][] = Array.from({ length: shards }, () => []);
  topics.forEach((t, ti) => {
    const base = maxNoByTopic[t] ?? 0;
    byTopic.get(t)!.forEach((d, i) => {
      shardItems[ti % shards].push({
        topicKey: t,
        chapter: d.대단원,
        topic: d.학습주제,
        section: 'E',
        no: base + 1 + i,
        derivedFromSerial: formatGrammarSerial(d.serialNo),
        src_question: d.question,
        src_answer: d.answer,
      });
    });
  });

  let totalItems = 0;
  shardItems.forEach((items, i) => {
    totalItems += items.length;
    const f = path.join(outDir, `task-${String(i + 1).padStart(2, '0')}.json`);
    fs.writeFileSync(f, JSON.stringify({ shard: i + 1, count: items.length, items }, null, 2));
  });
  console.log(`선택형 ${sel.length}개 · 진도 ${topics.length}개 → 샤드 ${shards}개 (총 배정 ${totalItems}) → ${outDir}`);
  shardItems.forEach((items, i) => console.log(`  task-${String(i + 1).padStart(2, '0')}.json : ${items.length}문항`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
