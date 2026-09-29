/**
 * 워커 자동 공급기 — launchd 로 5분마다 한 번 실행(ml/production/register_autofeed_launchd.sh).
 *  1) 저장: 관리 중인 묶음의 작업이 모두 끝나면 초안을 사전 검증(checkContentIntegrity + runPerQuestionValidations) →
 *     오류 없는 것만 공식 CLI(cc-variant-cli save)로 대기 저장 → 작업에 saved_question_id 표시. 오류 문항은 보류 목록에.
 *  2) 공급: 큐에 대기 작업이 LOW 개 미만이고 워커가 켜져 있으면, 지금 교재(plan.current)의 다음 회에서
 *     저장 0·작업 이력 없는 칸을 최대 8지문 × 12유형 묶음으로 만들어 등록(queue_worker_batch.ts check → enqueue).
 *     지금 교재에 남은 칸이 없으면 예약(plan.next) 첫 교재로 넘어간다.
 * 예약은 웹(비공개 트래커)의 「다음에 만들 교재」가 production_worker_plan 에 적는다. 이 스크립트는 모델을 부르지 않고,
 * 검수·완료 전환도 하지 않는다. 묶음 파일은 ml/production/batches/autofeed/ (공개 저장소 제외).
 *   npx tsx ml/production/autofeed.ts [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ObjectId } from 'mongodb';
import { getDb } from '../../lib/mongodb';
import { loadCliEnv } from '../../scripts/_cli-env';
import { LOCAL_VARIANT_TYPE_NAMES } from '../../lib/local-variant-types';
import { getLocalWorkerStatus, markLocalJobSaved } from '../../lib/local-variant-jobs';
import { checkContentIntegrity } from '../../lib/content-integrity-validation';
import { runPerQuestionValidations } from '../../lib/variant-review-validators';
import { generationProvenance, setGenerationProvenance } from './provenance';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
loadCliEnv(ROOT);
const BATCHES = path.join(ROOT, 'ml/production/batches');
const HOME = path.join(BATCHES, 'autofeed');
const REGISTRY = path.join(HOME, 'registry.json');
const LOG = path.join(HOME, 'autofeed.log');
const LOW = 20;           // 대기 작업이 이보다 적으면 다음 회를 넣는다
const MAX_PASSAGES = 8;   // 한 묶음 = 8지문 × 12유형 ≤ 96 (큐 도구 상한 100)
const PLAN_AHEAD = 5;     // 예약을 늘 이만큼 채워 둔다(자동 계획이 켜져 있을 때)
const DRY = process.argv.includes('--dry-run');
/** --dry-run --probe: 큐가 넉넉해도 다음에 넣을 묶음을 미리 계산만 한다(아무것도 쓰지 않음) */
const PROBE = DRY && process.argv.includes('--probe');

const log = (msg: string) => { const line = `[${new Date().toISOString()}] ${DRY ? '(dry) ' : ''}${msg}`; console.log(line); if (!DRY) fs.appendFileSync(LOG, line + '\n'); };
const readJson = <T>(f: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return fallback; } };
/** 하위 명령 실행 — 출력은 파일로 받는다. 파이프로 받으면 process.exit 가 8KB 에서 출력을 끊는다(저장 결과가 잘려 JSON 파싱 실패) */
const tsx = (args: string[]) => {
  const file = path.join(HOME, `.out-${process.pid}.txt`);
  const fd = fs.openSync(file, 'w');
  try { execFileSync('npx', ['tsx', ...args], { cwd: ROOT, stdio: ['ignore', fd, 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  finally { fs.closeSync(fd); }
  const out = fs.readFileSync(file, 'utf8'); fs.unlinkSync(file);
  return out;
};
/** 명령 출력에서 JSON 결과 읽기 — 한 줄 JSON(큐 도구)과 여러 줄로 펼친 JSON(cc-variant-cli save) 모두 */
const lastJson = (out: string) => {
  const text = out.trim();
  try { return JSON.parse(text); } catch { /* 앞에 로그가 섞인 경우 */ }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try { return JSON.parse(lines.slice(i).join('\n')); } catch { /* 더 위에서 시작하는 덩어리 */ }
  }
  fs.writeFileSync(path.join(HOME, 'last-bad-output.txt'), out.slice(0, 200_000));
  throw new Error('명령 결과 JSON 을 읽지 못함 (autofeed/last-bad-output.txt)');
};
/** 회 이름 정렬 — 「실전 모의고사 01회」「고난도 모의고사 13회」처럼 숫자로(없으면 이름) */
const chapterKey = (c: string) => { const m = c.match(/(\d+)\s*회/) ?? c.match(/(\d+)/); return [m ? Number(m[1]) : 9999, c] as const; };

type Registry = { batches: string[] };
type Plan = { current?: string | null; next?: string[]; paused?: boolean; autoPlan?: boolean; lastDone?: string | null };
// production_worker_plan 추가 필드: autoAdded(자동으로 넣은 교재) · dismissed(사용자가 뺀 자동 교재 — 다시 넣지 않음) · lastDone
type Candidate = { textbook: string; passages: number; reason: string };

/** 교재명의 연도(26년 → 2026, (2014) → 2014) — 없으면 0 */
const yearOf = (t: string) => { const m = t.match(/(?:^|\D)(\d{2})년/) ?? t.match(/\((\d{4})\)/); if (!m) return 0; const y = Number(m[1]); return y < 100 ? 2000 + y : y; };
const monthOf = (t: string) => Number(t.match(/(\d{1,2})월/)?.[1] ?? 0);
const seriesOf = (t: string) => t.trim().split(/\s+/)[0] ?? '';

/**
 * 자동 계획 — 예약이 비었을 때 다음 교재 후보(변형문제가 하나도 없고 워커에 넘긴 적도 없는, 원문 있는 교재).
 * 순서: ① 방금 끝낸 교재와 같은 시리즈(첫 낱말) ② 연도·월이 최근인 교재 ③ 지문 많은 교재.
 */
async function autoCandidates(db: Awaited<ReturnType<typeof getDb>>, lastDone: string | null, skip: Set<string>): Promise<Candidate[]> {
  const [passages, withVariants, withJobs] = await Promise.all([
    db.collection('passages').aggregate<{ _id: string; orig: number }>([
      { $match: { 'content.original': { $type: 'string', $ne: '' } } }, { $group: { _id: '$textbook', orig: { $sum: 1 } } }]).toArray(),
    db.collection('generated_questions').distinct('textbook'),
    db.collection('local_variant_jobs').distinct('textbook'),
  ]);
  const taken = new Set([...withVariants, ...withJobs].map(String));
  const series = lastDone ? seriesOf(lastDone) : '';
  return passages.filter((r) => r._id && !taken.has(String(r._id)) && !skip.has(String(r._id)) && r.orig >= 5)
    .map((r) => { const t = String(r._id); const same = !!series && seriesOf(t) === series; const y = yearOf(t);
      return { textbook: t, passages: r.orig, same, y, m: monthOf(t),
        reason: same ? `${series} 시리즈 이어서` : y ? `${y}년 최근 교재` : '변형 없는 교재' }; })
    .sort((a, b) => Number(b.same) - Number(a.same) || b.y - a.y || b.m - a.m || b.passages - a.passages || a.textbook.localeCompare(b.textbook, 'ko'))
    .map(({ textbook, passages: n, reason }) => ({ textbook, passages: n, reason }));
}

async function main() {
  fs.mkdirSync(HOME, { recursive: true });
  const lockFile = path.join(HOME, '.lock');
  let fd: number;
  try { fd = fs.openSync(lockFile, 'wx'); } catch {
    if (Date.now() - fs.statSync(lockFile).mtimeMs < 30 * 60_000) { console.log('다른 공급기 실행 중 — 건너뜀'); return; }
    fs.unlinkSync(lockFile); fd = fs.openSync(lockFile, 'wx');
  }
  const db = await getDb('gomijoshua');
  const planCol = db.collection<{ _id: string } & Plan & Record<string, unknown>>('production_worker_plan');
  try {
    const registry = readJson<Registry>(REGISTRY, { batches: [] });
    const actions: string[] = [];

    // 1) 끝난 묶음 저장
    for (const rel of registry.batches) {
      const dir = path.join(BATCHES, rel);
      if (fs.existsSync(path.join(dir, 'pending-save-results.json'))) continue;
      const snap = lastJson(tsx(['ml/production/queue_worker_batch.ts', 'snapshot', dir]));
      const counts = snap.counts ?? {};
      if ((counts.queued ?? 0) + (counts.running ?? 0) > 0) continue;
      const res = readJson<{ jobs: any[] }>(path.join(dir, 'job-results.json'), { jobs: [] });
      const done = res.jobs.filter((j) => j.status === 'done' && j.result?.question_data && !j.saved_question_id);
      const input: any[] = [], map: any[] = [], held: any[] = [];
      for (const j of done) {
        const doc = { type: j.type, passage_id: String(j.passage_id), question_data: j.result.question_data };
        // 해설 건너뛰기로 만든 초안(Explanation 빈칸)은 해설 규칙만 빼고 본다 — 해설은 검수 때 Claude 가 쓰고, 그 전엔 완료가 될 수 없다
        const noExpl = !String(j.result.question_data?.Explanation ?? '').trim();
        const issues = [...checkContentIntegrity(doc), ...await runPerQuestionValidations(db, doc)]
          .filter((x: any) => x.severity === 'error' && !(noExpl && String(x.rule ?? '').startsWith('explanation_')));
        const key = `${j.source}|${j.type}`;
        if (issues.length) { held.push({ job_id: String(j._id), key, errors: issues.map((x: any) => `${x.rule}: ${x.message}`) }); continue; }
        map.push({ index: input.length, job_id: String(j._id), key });
        // 해설 건너뛰기 초안 — 저장 CLI 가 빈 해설을 예비 문구로 채우지 않도록 표식을 넣는다. 검수(record.ts)가 Claude 해설로 바꾼 뒤에만 완료
        const qdSave = noExpl ? { ...j.result.question_data, Explanation: EXPL_PENDING } : j.result.question_data;
        input.push({ passage_id: String(j.passage_id), textbook: j.textbook, source: j.source, type: j.type, question_data: qdSave,
          status: '대기', option_type: 'English', ai_source: 'local-qwen-worker-unreviewed' });
      }
      fs.writeFileSync(path.join(dir, 'pending-save-held.json'), JSON.stringify(held, null, 1));
      if (DRY) { actions.push(`${rel}: 저장 예정 ${input.length} · 보류 ${held.length}`); continue; }
      fs.writeFileSync(path.join(dir, 'pending-save-input.json'), JSON.stringify(input, null, 1));
      fs.writeFileSync(path.join(dir, 'pending-save-map.json'), JSON.stringify(map, null, 1));
      let saved: any = { ok: true, total: 0, saved: 0, results: [] };
      if (input.length) saved = lastJson(tsx(['scripts/cc-variant-cli.ts', 'save', '--json', path.join(dir, 'pending-save-input.json')]));
      const manifest = readJson<any>(path.join(dir, 'manifest.json'), null);
      const workerDoc = await db.collection('local_variant_workers').findOne({ _id: 'MacBook-Pro.local' as any });
      for (const r of saved.results ?? []) {
        if (!(r.ok && r.inserted_id)) continue;
        const jobId = map[r.index]?.job_id;
        await markLocalJobSaved(db, jobId, new ObjectId(String(r.inserted_id)));
        const job = done.find((j) => String(j._id) === jobId);
        if (job) await setGenerationProvenance(db, String(r.inserted_id), generationProvenance(job, workerDoc, manifest), { by: 'autofeed', prevalidated: true });
      }
      fs.writeFileSync(path.join(dir, 'pending-save-results.json'), JSON.stringify(saved, null, 1));
      actions.push(`${rel}: 대기 저장 ${saved.saved ?? 0}/${input.length} (중복 ${saved.skipped_duplicate ?? 0}) · 검증 보류 ${held.length} · 생성 실패 ${counts.failed ?? 0}`);
    }

    // 2) 계획 채우기 — 예약(next)을 늘 PLAN_AHEAD 권까지 채워 둔다. 사용자는 웹에서 언제든 순서를 바꾸거나 뺄 수 있다.
    //    자동으로 넣은 교재는 autoAdded 에, 사용자가 뺀 자동 교재는 dismissed 에 남아 다시 넣지 않는다.
    //    웹과 동시에 고칠 수 있으니 「읽은 뒤 아무도 안 바꿨을 때만」 저장한다(바뀌었으면 다음 실행에서 다시).
    const planDoc = await planCol.findOne({ _id: 'main' });
    const plan: Plan = { current: planDoc?.current ?? null, next: Array.isArray(planDoc?.next) ? planDoc!.next as string[] : [], paused: planDoc?.paused === true,
      autoPlan: planDoc?.autoPlan !== false, lastDone: typeof planDoc?.lastDone === 'string' ? planDoc.lastDone : null };
    const readNext = [...(plan.next ?? [])];
    const dismissed = new Set((planDoc?.dismissed as string[] | undefined) ?? []);
    const autoAdded = new Set((planDoc?.autoAdded as string[] | undefined) ?? []);
    let lastDone = plan.lastDone ?? null;
    let current = plan.current ?? null;
    const next = [...readNext];
    const topUp = async () => {
      if (!plan.autoPlan || next.length >= PLAN_AHEAD) return;
      const skip = new Set([...next, ...dismissed, ...(current ? [current] : [])]);
      for (const c of await autoCandidates(db, current ?? lastDone, skip)) {
        if (next.length >= PLAN_AHEAD) break;
        next.push(c.textbook); autoAdded.add(c.textbook); actions.push(`계획 추가: ${c.textbook} (${c.reason})`);
      }
    };
    const savePlan = async (extra: Record<string, unknown>) => {
      if (DRY) return;
      const r = await planCol.updateOne({ _id: 'main', next: readNext } as any,
        { $set: { current, next, lastDone, autoAdded: [...autoAdded].filter((t) => next.includes(t) || t === current), ...extra } });
      if (!r.matchedCount) {  // 웹이 먼저 바꿨음 — 예약은 두고 상태만
        await planCol.updateOne({ _id: 'main' }, { $set: { feeder: { at: new Date(), state: 'feeding', action: '예약이 방금 바뀌어 다음 실행에서 다시 계획' } } }, { upsert: true });
        actions.push('예약이 방금 바뀜 — 다음 실행에서 반영');
      }
    };
    const feeder = (state: string) => ({ feeder: { at: new Date(), state, action: actions.join(' / ') || '할 일 없음' } });

    await topUp();
    if (plan.paused) { await savePlan(feeder('paused')); log(`멈춤 ${actions.join(' / ')}`); return; }
    const worker = await getLocalWorkerStatus(db);
    if (!worker.workers.some((w) => w.online && !w.fake)) { actions.push('워커가 꺼져 있어 공급하지 않음'); await savePlan(feeder('no-worker')); log(actions.join(' / ')); return; }
    const queued = await db.collection('local_variant_jobs').countDocuments({ status: 'queued' });
    if (queued >= LOW && !PROBE) { actions.push(`큐 대기 ${queued} — 충분`); await savePlan(feeder('feeding')); log(actions.join(' / ')); return; }

    // 3) 다음 회 공급 — 지금 교재에 남은 칸이 없으면 예약 첫 교재로
    for (let guard = 0; guard < 25; guard++) {
      if (!current) {
        current = next.shift() ?? null;
        if (!current) break;
        autoAdded.delete(current);
        actions.push(`다음 교재 시작: ${current}`);
        await topUp();
      }
      const batch = await prepareNext(db, current, (planDoc?.topup as Record<string, Topup> | undefined)?.[current]);
      if (batch) {
        if (!DRY) {
          tsx(['ml/production/queue_worker_batch.ts', 'check', path.join(BATCHES, batch.rel)]);
          tsx(['ml/production/queue_worker_batch.ts', 'enqueue', path.join(BATCHES, batch.rel)]);
          registry.batches.push(batch.rel);
          fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 1));
        }
        actions.push(`등록 ${batch.chapter} ${batch.passages}지문 ${batch.slots}작업`);
        break;
      }
      actions.push(`${current}: 남은 칸 없음 — 끝`);
      lastDone = current;
      current = null;
    }
    await savePlan(feeder(current ? 'feeding' : 'idle'));
    log(actions.join(' / ') || '할 일 없음');
  } finally { fs.closeSync(fd); fs.unlinkSync(lockFile); }
}

/** 부족분 제작 예약 — 칸(지문×유형)마다 perSlot 문항까지. 시작 때 남은 부족분(baseNeed)은 웹 진행 바 기준 */
type Topup = { perSlot: number; baseNeed?: number; startedAt?: Date };
const TOPUP_MAX_FAILS = 2;
/** 해설 건너뛰기 표식 — record.ts 가 이 문구가 남아 있으면 완료로 올리지 않는다 */
const EXPL_PENDING = '[해설 작성 전 — 검수 때 Claude 가 씁니다]';

/** 지금 교재의 다음 회에서 빈 칸(저장 0·작업 이력 없음)을 최대 8지문 묶음으로 만든다.
 *  부족분 예약(topup)이 있으면: 저장이 perSlot 보다 적고, 진행 중·저장 전 작업이 없고, 예약 뒤 실패가 2번 미만인 칸 — 한 묶음에 칸당 1작업(다음 차례에 또 채운다).
 *  queue_worker_batch check 와 같은 조건이어야 묶음이 통째로 거절되지 않는다. */
async function prepareNext(db: Awaited<ReturnType<typeof getDb>>, textbook: string, topup?: Topup) {
  const ps = await db.collection('passages').find({ textbook }, { projection: { chapter: 1, number: 1, 'content.original': 1 } }).toArray();
  const jobRows = await db.collection('local_variant_jobs').find({ textbook }, { projection: { passage_id: 1, type: 1, status: 1, saved_question_id: 1, created_at: 1, error: 1 } }).toArray();
  const tried = new Set(jobRows.map((j) => `${j.passage_id}|${j.type}`));
  const busy = new Set(jobRows.filter((j) => ['queued', 'running', 'done'].includes(String(j.status)) && !j.saved_question_id).map((j) => `${j.passage_id}|${j.type}`));
  const fails = new Map<string, number>();
  if (topup?.startedAt) for (const j of jobRows) if (j.status === 'failed' && j.created_at >= topup.startedAt) { const k = `${j.passage_id}|${j.type}`; fails.set(k, (fails.get(k) ?? 0) + 1); }
  // 「지문이 짧아」(문장 수 부족)는 다시 돌려도 똑같이 실패한다 — 워커 불가 칸은 부족분에서 빼고 Claude 가 직접 쓴다
  const tooShort = new Set(jobRows.filter((j) => j.status === 'failed' && /지문이 짧아/.test(String(j.error ?? ''))).map((j) => `${j.passage_id}|${j.type}`));
  const qRows = await db.collection('generated_questions').find({ textbook }, { projection: { passage_id: 1, type: 1 } }).toArray();
  const stored = new Set(qRows.map((q) => `${q.passage_id}|${q.type}`));
  const storedN = new Map<string, number>();
  for (const q of qRows) { const k = `${q.passage_id}|${q.type}`; storedN.set(k, (storedN.get(k) ?? 0) + 1); }
  const canFill = (k: string) => !!topup && (storedN.get(k) ?? 0) < topup.perSlot && !busy.has(k) && !tooShort.has(k) && (fails.get(k) ?? 0) < TOPUP_MAX_FAILS;
  // 세트 순서 — 채울 수 있는 칸 중 문항이 가장 적은 층부터(1세트 → 2세트 → 3세트). 웹의 세트별 바와 같은 순서
  let level = Infinity;
  if (topup) for (const p of ps) for (const type of LOCAL_VARIANT_TYPE_NAMES) { const k = `${p._id}|${type}`; if (canFill(k)) level = Math.min(level, storedN.get(k) ?? 0); }
  const openSlot = (pid: string, type: string) => {
    const k = `${pid}|${type}`;
    if (!topup) return !tried.has(k) && !stored.has(k);
    return canFill(k) && (storedN.get(k) ?? 0) === level;
  };
  const chapters = [...new Set(ps.map((p: any) => String(p.chapter ?? '')))].sort((a, b) => { const [x, xs] = chapterKey(a), [y, ys] = chapterKey(b); return x - y || xs.localeCompare(ys, 'ko'); });
  for (const chapter of chapters) {
    const inChapter = ps.filter((p: any) => String(p.chapter ?? '') === chapter && String(p.content?.original ?? '').trim())
      .sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), 'ko', { numeric: true }));
    const slots: any[] = []; const used = new Set<string>();
    for (const p of inChapter) {
      if (used.size >= MAX_PASSAGES) break;
      const paragraph = String((p as any).content.original).trim();
      const open = LOCAL_VARIANT_TYPE_NAMES.filter((type) => openSlot(String(p._id), type));
      if (!open.length) continue;
      used.add(String(p._id));
      const source = `${p.chapter} ${p.number}`;
      for (const type of open) slots.push({ key: `${source}|${type}`, passage_id: String(p._id), textbook, source, type, paragraph, paragraph_sha256: crypto.createHash('sha256').update(paragraph).digest('hex') });
    }
    if (!slots.length) continue;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const rel = `autofeed/${stamp}-${crypto.createHash('sha1').update(textbook + chapter).digest('hex').slice(0, 8)}`;
    if (!DRY) {
      fs.mkdirSync(path.join(BATCHES, rel), { recursive: true });
      fs.writeFileSync(path.join(BATCHES, rel, 'manifest.json'), JSON.stringify({ batch_id: rel.replace('/', '-'), created_at: new Date().toISOString(), textbook, chapter,
        target_completed_per_type: topup ? topup.perSlot : 1, first_pass_per_empty_slot: 1, max_jobs: slots.length, allow_existing_under_target: !!topup, notebook_anchor: 'l40',
        selection_policy: topup ? `자동 공급기(부족분): 칸당 ${topup.perSlot}문항까지 세트 순서(문항 ${level}개인 칸), 진행 중·저장 전 작업 없고 예약 뒤 실패 ${TOPUP_MAX_FAILS}번 미만 — 칸당 1작업`
          : '자동 공급기: 예약 교재의 다음 회, 원문 있는 지문 최대 8개 × 12유형 중 저장 0·작업 이력 없는 칸. 적합성 사전 선별 없음', slots }, null, 2) + '\n');
    }
    return { rel, chapter, passages: used.size, slots: slots.length };
  }
  return null;
}

main().then(() => process.exit(0)).catch(async (e) => {
  const msg = e instanceof Error && !/mongodb|password|uri/i.test(e.message) ? e.message.slice(0, 300) : '공급기 오류';
  log(`오류: ${msg}`);
  try { const db = await getDb('gomijoshua'); if (!DRY) await db.collection<{ _id: string }>('production_worker_plan').updateOne({ _id: 'main' }, { $set: { feeder: { at: new Date(), state: 'error', action: msg } } }, { upsert: true }); } catch { /* 기록 실패는 무시 */ }
  process.exit(1);
});
