/**
 * 기출 교재의 자체 문항을 원출처 지문으로 옮긴다 (2026-09-27 끌어오기 정책).
 *   npx tsx scripts/move-exam-own-to-origin.ts "<교재>"            # dry-run
 *   npx tsx scripts/move-exam-own-to-origin.ts "<교재>" --apply    # 백업 JSON 저장 후 실제 이동
 * 이동: passage_id·textbook·source·question_data.Source → 원출처, moved_from 에 옛 값 기록.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never); config({ quiet: true } as never);
import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { resolveExamOrigins } from '@/lib/exam-origin';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

const TB = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!TB) { console.error('교재명을 주세요'); process.exit(1); }

(async () => {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const docs = await col.find({ textbook: TB }).project({ _id: 1, textbook: 1, passage_id: 1, source: 1, type: 1, 'question_data.Source': 1 }).toArray();
  const pids = [...new Set(docs.map((d) => String(d.passage_id ?? '')).filter((x) => ObjectId.isValid(x)))];
  const origins = await resolveExamOrigins(db, pids);
  const narr = await db.collection('narrative_questions').countDocuments({ textbook: TB });

  const plan: { _id: ObjectId; set: Record<string, unknown> }[] = [];
  const backup: Record<string, unknown>[] = [];
  const unresolved = new Map<string, number>();
  const byOriginTb = new Map<string, number>();
  let pidString = 0;
  for (const d of docs) {
    const o = origins.get(String(d.passage_id ?? ''));
    if (!o) { const k = String(d.source ?? '?'); unresolved.set(k, (unresolved.get(k) ?? 0) + 1); continue; }
    if (typeof d.passage_id === 'string') pidString++;
    const source = normalizeMockVariantSourceLabel(o.originTextbook, o.originSourceKey);
    const qdSource = (d.question_data as Record<string, unknown> | undefined)?.Source;
    const set: Record<string, unknown> = {
      passage_id: typeof d.passage_id === 'string' ? o.originId.toHexString() : o.originId,
      textbook: o.originTextbook,
      source,
      moved_from: { textbook: d.textbook, passage_id: d.passage_id, source: d.source, reason: 'exam-origin-pull', moved_at: new Date() },
    };
    if (qdSource !== undefined) set['question_data.Source'] = source;
    plan.push({ _id: d._id as ObjectId, set });
    backup.push({ _id: String(d._id), textbook: d.textbook, passage_id: String(d.passage_id), passage_id_type: typeof d.passage_id, source: d.source, qdSource: qdSource ?? null });
    byOriginTb.set(o.originTextbook, (byOriginTb.get(o.originTextbook) ?? 0) + 1);
  }
  console.log(JSON.stringify({
    textbook: TB, own: docs.length, movable: plan.length, unresolved: Object.fromEntries(unresolved), narrativeOwn: narr, passageIdAsString: pidString,
    toOriginTextbooks: Object.fromEntries([...byOriginTb].sort((a, b) => b[1] - a[1])),
    sample: plan.slice(0, 2).map((p) => ({ _id: String(p._id), textbook: p.set.textbook, source: p.set.source })),
  }, null, 1));
  if (!APPLY) { console.log('dry-run — --apply 로 실제 이동'); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `.tmp/backup-exam-origin-move-${stamp}.json`;
  fs.mkdirSync('.tmp', { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ textbook: TB, at: new Date(), docs: backup }, null, 1));
  console.log('backup', file, backup.length);
  let modified = 0;
  for (let i = 0; i < plan.length; i += 500) {
    const r = await col.bulkWrite(plan.slice(i, i + 500).map((p) => ({ updateOne: { filter: { _id: p._id, textbook: TB }, update: { $set: p.set } } })));
    modified += r.modifiedCount;
  }
  console.log('modified', modified, 'remaining own', await col.countDocuments({ textbook: TB }));
  process.exit(0);
})();
