/**
 * 로컬 LoRA 실사용 지표 — 워커가 만든 초안을 사람이 얼마나 고쳐서 저장했는지 (DB 읽기 전용).
 *
 *   npm run cc:local-usage
 *   npm run cc:local-usage -- --days 7 --type 빈칸 --details
 *   npm run cc:local-usage -- --json out.json
 *
 * 시험지(ml/eval)는 제가 고른 지문·채점 기준으로 재는 성적이고, 이건 실제로 쓰인 결과다(노트 로드맵 2번).
 *   그대로    : 선지·정답·지문(빈칸 위치)·해설이 초안과 같다
 *   조금 수정 : 정답은 그대로, 선지는 모두 초안과 거의 같다(단어 80% 이상 겹침) — 또는 해설만 고쳤다
 *   크게 수정 : 정답이 바뀌었거나, 선지를 새로 썼거나, 빈칸 위치(지문)가 바뀌었다
 *   버림      : 초안이 끝난 지 2시간이 넘도록 저장되지 않았다
 * 짝짓기: 저장 요청에 실린 작업 번호(local_job_id → 작업의 saved_question_id)가 있으면 그걸로, 없으면(이 기능
 * 이전 저장분) 같은 지문·유형·로컬 출처로 초안이 끝난 뒤 12시간 안에 저장된 첫 문항으로 추정한다.
 * 작업 기록은 30일이 지나면 지워진다(lib/local-variant-jobs.ts) — 그보다 오래된 초안은 셀 수 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { LOCAL_VARIANT_JOBS_COLLECTION } from '@/lib/local-variant-jobs';
import { LOCAL_VARIANT_TYPES } from '@/lib/local-variant-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadCliEnv(path.resolve(__dirname, '..'));

type Qd = Record<string, unknown>;
type Verdict = '그대로' | '조금 수정' | '크게 수정' | '버림';
const VERDICTS: Verdict[] = ['그대로', '조금 수정', '크게 수정', '버림'];
const CIRCLED = '①②③④⑤';
const PENDING_MS = 2 * 3600_000;
const MATCH_WINDOW_MS = 12 * 3600_000;

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else flags.set(key, 'true');
  }
  return flags;
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const words = (s: string) => s.toLowerCase().match(/[a-z0-9'가-힣]+/g) ?? [];

/** 단어 겹침(주사위 계수) — 0..1 */
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length && !wb.length) return 1;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = count.get(w) ?? 0;
    if (n > 0) {
      common++;
      count.set(w, n - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

function options(qd: Qd): string[] {
  const raw = String(qd.Options ?? '');
  const parts = raw.includes('###') ? raw.split('###') : raw.includes('\n') ? raw.split(/\n+/) : raw.split(/(?=[①②③④⑤])/);
  return parts.map((p) => norm(p.replace(/^[①②③④⑤]\s*/, ''))).filter(Boolean);
}

function answerText(qd: Qd): string {
  const i = CIRCLED.indexOf(String(qd.CorrectAnswer ?? '').trim());
  return i >= 0 ? options(qd)[i] ?? '' : '';
}

/** 초안 → 저장본 — 판정과 무엇을 고쳤는지 */
function compare(draft: Qd, saved: Qd): { verdict: Verdict; changed: string[] } {
  const changed: string[] = [];
  const dOpts = options(draft);
  const sOpts = options(saved);
  const answerSame = similarity(answerText(draft), answerText(saved)) >= 0.9;
  if (!answerSame) changed.push('정답');
  // 저장본 선지마다 초안에서 가장 닮은 선지를 찾는다(순서를 섞어 저장해도 같은 선지로 본다)
  const best = sOpts.map((o) => Math.max(0, ...dOpts.map((d) => similarity(o, d))));
  const optsIdentical = dOpts.length === sOpts.length && best.every((b) => b === 1);
  const optsClose = dOpts.length === sOpts.length && best.every((b) => b >= 0.8);
  if (!optsIdentical) changed.push(optsClose ? '선지(조금)' : '선지(새로)');
  const paraSame = norm(draft.Paragraph) === norm(saved.Paragraph);
  if (!paraSame) changed.push('지문');
  const explSame = norm(draft.Explanation) === norm(saved.Explanation);
  if (!explSame) changed.push('해설');
  if (!answerSame || !optsClose || !paraSame) return { verdict: '크게 수정', changed };
  if (optsIdentical && explSame) return { verdict: '그대로', changed };
  return { verdict: '조금 수정', changed };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const days = Number(flags.get('days') || '30');
  const typeFilter = flags.get('type');
  const since = new Date(Date.now() - days * 86400_000);
  const db = await getDb('gomijoshua');
  const gq = db.collection('generated_questions');
  const aiSources = Object.values(LOCAL_VARIANT_TYPES).map((t) => t.aiSource);

  const jobs = await db
    .collection(LOCAL_VARIANT_JOBS_COLLECTION)
    .find({
      requested_by: { $ne: 'claude-harness' },
      created_at: { $gte: since },
      ...(typeFilter ? { type: typeFilter } : {}),
    })
    .sort({ created_at: 1 })
    .toArray();

  type Row = { job: string; type: string; source: string; verdict: Verdict | '실패' | '진행 중'; changed: string[]; warned: boolean; matchedBy: string };
  const rows: Row[] = [];
  const used = new Set<string>();
  for (const job of jobs) {
    const type = String(job.type);
    const base = { job: String(job._id), type, source: String(job.source ?? ''), changed: [] as string[], matchedBy: '' };
    const warned = Array.isArray(job.result?.warnings) && job.result.warnings.length > 0;
    if (job.status === 'failed') {
      rows.push({ ...base, verdict: '실패', warned });
      continue;
    }
    if (job.status !== 'done' || !job.result?.question_data || job.result?.fake) continue;
    let saved: Record<string, unknown> | null = null;
    let matchedBy = '';
    if (job.saved_question_id instanceof ObjectId) {
      saved = await gq.findOne({ _id: job.saved_question_id });
      matchedBy = '작업 번호';
    }
    if (!saved && job.finished_at) {
      const cands = await gq
        .find({
          passage_id: job.passage_id,
          type,
          ai_source: { $in: aiSources },
          $or: [
            { created_at: { $gte: job.finished_at, $lte: new Date(+job.finished_at + MATCH_WINDOW_MS) } },
            { updated_at: { $gte: job.finished_at, $lte: new Date(+job.finished_at + MATCH_WINDOW_MS) } },
          ],
        })
        .sort({ updated_at: 1 })
        .toArray();
      saved = cands.find((c) => !used.has(String(c._id))) ?? null;
      if (saved) matchedBy = '추정';
    }
    if (saved) {
      used.add(String(saved._id));
      const { verdict, changed } = compare(job.result.question_data as Qd, (saved.question_data ?? {}) as Qd);
      rows.push({ ...base, verdict, changed, warned, matchedBy });
    } else {
      const age = Date.now() - +(job.finished_at ?? job.updated_at);
      rows.push({ ...base, verdict: age > PENDING_MS ? '버림' : '진행 중', warned, matchedBy: '' });
    }
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
  const types = [...new Set(rows.map((r) => r.type))];
  console.log(`로컬 LoRA 실사용 — 최근 ${days}일, 작업 ${rows.length}건 (워커 시험·Claude 하네스 제외)\n`);
  console.log(['유형', '초안', ...VERDICTS, '생성 실패', '경고 붙은 초안'].map((h) => h.padEnd(8)).join(' '));
  for (const t of [...types, '전체']) {
    const rs = rows.filter((r) => (t === '전체' || r.type === t) && r.verdict !== '진행 중');
    const drafts = rs.filter((r) => r.verdict !== '실패');
    const cells = VERDICTS.map((v) => pct(drafts.filter((r) => r.verdict === v).length, drafts.length));
    console.log(
      [t, String(drafts.length), ...cells, pct(rs.length - drafts.length, rs.length), pct(drafts.filter((r) => r.warned).length, drafts.length)]
        .map((c) => c.padEnd(8))
        .join(' ')
    );
  }
  const decided = rows.filter((r) => VERDICTS.includes(r.verdict as Verdict));
  const warnedEdited = decided.filter((r) => r.warned && r.verdict !== '그대로').length;
  const plainEdited = decided.filter((r) => !r.warned && r.verdict !== '그대로').length;
  console.log(
    `\n경고 붙은 초안 중 고치거나 버린 비율 ${pct(warnedEdited, decided.filter((r) => r.warned).length)} · ` +
      `경고 없는 초안 중 ${pct(plainEdited, decided.filter((r) => !r.warned).length)}` +
      ` — 경고가 실제 문제를 가리키는지 보는 줄`
  );
  const byMatch = decided.filter((r) => r.matchedBy === '추정').length;
  if (byMatch) console.log(`짝짓기: 작업 번호 ${decided.filter((r) => r.matchedBy === '작업 번호').length}건 · 추정 ${byMatch}건`);
  const pending = rows.filter((r) => r.verdict === '진행 중').length;
  if (pending) console.log(`아직 2시간이 안 된 미저장 초안 ${pending}건은 셈에서 뺐다`);

  if (flags.get('details') === 'true') {
    console.log('\n세부:');
    for (const r of rows) console.log(`  ${r.type}\t${r.verdict}\t${r.changed.join('·') || '-'}\t${r.warned ? '경고' : ''}\t${r.source}`);
  }
  const jsonOut = flags.get('json');
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ days, rows }, null, 2), 'utf8');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
