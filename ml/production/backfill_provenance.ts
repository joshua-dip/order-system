/**
 * 이미 저장된 문항에 이력(provenance) 채우기 — 묶음 폴더의 기록(job-results·pending-save-map/results·manifest·worker-models)과
 * 검수 샤드(answers·blind-answers·result)에서. provenance.* 만 $set, 여러 번 돌려도 같다.
 *   npx tsx ml/production/backfill_provenance.ts [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../lib/mongodb';
import { loadCliEnv } from '../../scripts/_cli-env';
import { generationProvenance, setGenerationProvenance, setReviewProvenance } from './provenance';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
loadCliEnv(ROOT);
const DRY = process.argv.includes('--dry-run');
const read = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const BATCHES = path.join(ROOT, 'ml/production/batches');

(async () => {
  const db = await getDb('gomijoshua');
  const currentWorker = await db.collection('local_variant_workers').findOne({ _id: 'MacBook-Pro.local' as any });
  const dirs = [...fs.readdirSync(BATCHES).map((d) => path.join(BATCHES, d)), ...(fs.existsSync(path.join(BATCHES, 'autofeed')) ? fs.readdirSync(path.join(BATCHES, 'autofeed')).map((d) => path.join(BATCHES, 'autofeed', d)) : [])]
    .filter((d) => fs.existsSync(path.join(d, 'job-results.json')) && fs.existsSync(path.join(d, 'pending-save-results.json')));
  let gen = 0, missing = 0;
  for (const dir of dirs) {
    const jobs: any[] = read(path.join(dir, 'job-results.json'))?.jobs ?? [];
    const map: any[] = read(path.join(dir, 'pending-save-map.json')) ?? [];
    const res = read(path.join(dir, 'pending-save-results.json'));
    const manifest = read(path.join(dir, 'manifest.json'));
    const wm = read(path.join(dir, 'worker-models.json'))?.workers?.[0] ?? currentWorker;
    const byJob = new Map(jobs.map((j) => [String(j._id), j]));
    const autofeed = dir.includes(`${path.sep}autofeed${path.sep}`) || /silj01/.test(dir);
    for (const r of res?.results ?? []) {
      const qid = r.inserted_id ?? (r.skipped_duplicate ? null : null);
      const job = byJob.get(String(map[r.index]?.job_id ?? ''));
      if (!qid || !job) { if (r.ok) missing++; continue; }
      if (!DRY) await setGenerationProvenance(db, qid, generationProvenance(job, wm, manifest),
        { at: job.saved_at ? new Date(job.saved_at) : undefined, by: autofeed ? 'autofeed' : 'batch-save', prevalidated: true });
      gen++;
    }
  }
  // 검수 이력
  const SHARDS = path.join(BATCHES, 'powerup-review/shards');
  let rev = 0;
  for (const s of fs.existsSync(SHARDS) ? fs.readdirSync(SHARDS) : []) {
    const answers: any[] | null = read(path.join(SHARDS, s, 'answers.json'));
    const result = read(path.join(SHARDS, s, 'result.json'));
    if (!answers || !result) continue;
    const blind = new Map(((read(path.join(SHARDS, s, 'blind-answers.json')) ?? []) as any[]).map((b) => [b.id, b.answer]));
    const outcome = new Map((result.done ?? []).map((r: any) => [r?.generated_question_id, r?.status_updated_to_complete ? '완료' : r?.status_updated_to_mismatch ? '검수불일치' : '대기']));
    for (const a of answers) {
      if (!DRY) await setReviewProvenance(db, a.id, { by: 'claude-code', model: 'claude-opus-5-5', method: 'blind-solve+key-check', verdict: a.verdict, tags: a.tags ?? [],
        note: a.note, blind_answer: blind.get(a.id) ?? (s === 'u01-pilot1' ? a.answer : undefined), at: new Date(result.at), shard: s, outcome: (outcome.get(a.id) as string) ?? '대기(보류)' });
      rev++;
    }
  }
  console.log(JSON.stringify({ dry: DRY, batches: dirs.length, generation: gen, generationMissing: missing, review: rev }));
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error && !/mongodb|password|uri/i.test(e.message) ? e.message : 'failed'); process.exit(1); });
