/**
 * Claude Code 전용: VIP 수학 문제은행 CLI (vip_math_problems).
 * Pro 구독으로 채팅에서 문항(문제·정답·풀이)을 작성하고, 이 스크립트로 검증·저장만 담당 → Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI 는 .env / .env.local):
 *
 *   npx tsx scripts/cc-math-cli.ts curricula
 *   npx tsx scripts/cc-math-cli.ts topics   --textbook "중3-1(22개정)" [--user <email|loginId|이름>] [--limit 400]
 *   npx tsx scripts/cc-math-cli.ts shortage --textbook "중3-1(22개정)"  --user <...> [--limit 400]
 *   npx tsx scripts/cc-math-cli.ts save     --json draft.json [--dry-run] [--force]
 *   npx tsx scripts/cc-math-cli.ts save-all  draft1.json draft2.json ... [--dry-run]
 *   cat draft.json | npx tsx scripts/cc-math-cli.ts save --json -
 *   단축: npx tsx scripts/cc-math-cli.ts "중3-1(22개정)"   → topics
 *
 * save 입력 JSON 스키마:
 *   {
 *     "user":   "<email|loginId|이름>",   // 소유자 (필수)
 *     "source": "자체 제작",               // 출처 라벨 (선택, 기본 "자체 제작")
 *     "problems": [
 *       { "topicKey": "중3-1(22개정) > 실수와 그 계산 > … > 주제",  // 트리와 정확히 일치
 *         "no": 1, "difficulty": "기본"|"중"|"고", "type": "주관식"|"객관식",
 *         "question": "문제 본문(여러 줄 가능)",
 *         "choices": ["①내용","②내용", …],   // 객관식만 (4~5지)
 *         "answer": "√3" | "③",               // 주관식=값/식 · 객관식=①~⑤
 *         "solution": "풀이/해설" }
 *     ]
 *   }
 *   · topicKey 대신 교과/대단원/중단원/소단원/그룹명/학습주제 필드로 줘도 됨(자동 조합).
 *   · 멱등: (userId, topicKey, no) upsert — 재실행해도 중복 삽입 없음(신규만 serialNo 발급).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  MATH_CURRICULA,
  buildMathTopicIndex,
  countTopics,
  mathTopicKey,
  type MathTopicRef,
} from '@/lib/math-curriculum';
import {
  MATH_PROBLEMS_COLLECTION,
  MATH_DIFFICULTIES,
  MATH_PROBLEM_TYPES,
  nextMathSerial,
  formatMathSerial,
} from '@/lib/vip-math-problem-bank';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const CIRCLED = ['①', '②', '③', '④', '⑤'];

// ── 공용 유틸 ─────────────────────────────────────────────────────────────────

function parseFlags(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags.set(key, next); i++; }
      else flags.set(key, 'true');
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function out(obj: unknown) { console.log(JSON.stringify(obj, null, 2)); }
function die(msg: string): never { console.error(msg); process.exit(1); }

function flagNum(flags: Map<string, string>, key: string, fallback: number): number {
  const v = flags.get(key);
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${key} 는 숫자여야 합니다.`);
  return n;
}
function flagBool(flags: Map<string, string>, key: string): boolean {
  const v = flags.get(key);
  return v === 'true' || v === '1';
}

function parseJsonInput(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  try { return JSON.parse(text); }
  catch (e) { die(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`); }
}

async function resolveUser(who: string | undefined): Promise<{ userId: ObjectId; name: string; loginId: string }> {
  if (!who) die('--user <email|loginId|이름> 가 필요합니다.');
  const db = await getDb('gomijoshua');
  const u = await db.collection('users').findOne(
    { $or: [{ email: who }, { loginId: who }, { name: who }] },
    { projection: { name: 1, loginId: 1, email: 1 } },
  );
  if (!u) die(`사용자를 찾을 수 없습니다: ${who}`);
  return { userId: u._id as ObjectId, name: String(u.name ?? ''), loginId: String(u.loginId ?? '') };
}

/** --textbook 교과명 → MathCurriculum. */
function findCurriculum(textbook: string) {
  const c = MATH_CURRICULA.find((x) => x.교과 === textbook);
  if (!c) {
    const names = MATH_CURRICULA.map((x) => x.교과).join(', ');
    die(`교과 "${textbook}" 를 찾을 수 없습니다. 가능: ${names}`);
  }
  return c;
}

// ── curricula ─────────────────────────────────────────────────────────────────

function cmdCurricula() {
  out({
    ok: true,
    count: MATH_CURRICULA.length,
    curricula: MATH_CURRICULA.map((c) => ({
      교과: c.교과, 학교급: c.학교급, 대단원수: c.대단원.length, 주제수: countTopics(c),
    })),
  });
}

// ── topics / shortage ──────────────────────────────────────────────────────────

/** 한 교과의 리프 topicKey 목록 (선택 시 소유자별 보유 수 병기). */
async function listTopics(textbook: string, user: string | undefined, limit: number, onlyEmpty: boolean) {
  const c = findCurriculum(textbook);
  const index = buildMathTopicIndex();
  const refs: MathTopicRef[] = [...index.values()].filter((r) => r.교과 === textbook);

  let counts: Record<string, number> = {};
  let owner = '';
  if (user) {
    const resolved = await resolveUser(user);
    owner = resolved.name || resolved.loginId;
    const db = await getDb('gomijoshua');
    const rows = await db.collection(MATH_PROBLEMS_COLLECTION)
      .aggregate([{ $match: { userId: resolved.userId } }, { $group: { _id: '$topicKey', n: { $sum: 1 } } }])
      .toArray();
    for (const r of rows) counts[String(r._id)] = r.n as number;
  }

  let items = refs.map((r) => ({
    topicKey: r.topicKey,
    대단원: r.대단원, 중단원: r.중단원, 소단원: r.소단원, 그룹명: r.그룹명 ?? '', 학습주제: r.학습주제,
    count: counts[r.topicKey] ?? 0,
  }));
  if (onlyEmpty) items = items.filter((x) => x.count === 0);
  const total = items.length;
  items = items.slice(0, Math.max(1, limit));

  out({
    ok: true,
    교과: textbook, 학교급: c.학교급,
    owner: owner || undefined,
    total_topics: refs.length,
    returned: items.length,
    remaining: Math.max(0, total - items.length),
    topics: items,
  });
}

// ── save ─────────────────────────────────────────────────────────────────────

interface ProblemIn {
  topicKey?: string;
  교과?: string; 대단원?: string; 중단원?: string; 소단원?: string; 그룹명?: string; 학습주제?: string;
  no?: number;
  difficulty?: string;
  type?: string;
  question?: string;
  choices?: string[];
  answer?: string;
  solution?: string;
}
interface SaveInput { user?: string; source?: string; problems?: ProblemIn[] }

/** 문항 하나 검증 → 정규화(좌표 보강). 오류 배열 반환. */
function validateProblem(
  p: ProblemIn,
  idx: number,
  index: Map<string, MathTopicRef>,
): { errors: string[]; normalized?: { ref: MathTopicRef; no: number; difficulty: string; type: string; question: string; choices?: string[]; answer: string; solution: string } } {
  const errors: string[] = [];
  const tag = `problems[${idx}]`;

  // topicKey (직접 또는 필드 조합)
  let topicKey = (p.topicKey ?? '').trim();
  if (!topicKey && p.교과 && p.대단원 && p.중단원 && p.소단원 && p.학습주제) {
    topicKey = mathTopicKey(p.교과, p.대단원, p.중단원, p.소단원, p.그룹명 ?? '', p.학습주제);
  }
  if (!topicKey) { errors.push(`${tag}: topicKey(또는 교과/대단원/중단원/소단원/학습주제)가 필요합니다.`); return { errors }; }
  const ref = index.get(topicKey);
  if (!ref) { errors.push(`${tag}: 트리에 없는 topicKey — "${topicKey}"`); return { errors }; }

  const question = (p.question ?? '').trim();
  const answer = (p.answer ?? '').trim();
  const solution = (p.solution ?? '').trim();
  if (!question) errors.push(`${tag}: question 이 비었습니다.`);
  if (!answer) errors.push(`${tag}: answer 가 비었습니다.`);

  const difficulty = (p.difficulty ?? '기본').trim();
  if (!(MATH_DIFFICULTIES as readonly string[]).includes(difficulty)) errors.push(`${tag}: difficulty 는 ${MATH_DIFFICULTIES.join('|')} 중 하나 — "${difficulty}"`);
  const type = (p.type ?? '주관식').trim();
  if (!(MATH_PROBLEM_TYPES as readonly string[]).includes(type)) errors.push(`${tag}: type 은 ${MATH_PROBLEM_TYPES.join('|')} 중 하나 — "${type}"`);

  let choices: string[] | undefined;
  if (type === '객관식') {
    choices = Array.isArray(p.choices) ? p.choices.map((s) => String(s).trim()).filter(Boolean) : [];
    if (choices.length < 4 || choices.length > 5) errors.push(`${tag}: 객관식 choices 는 4~5개 — 현재 ${choices.length}개`);
    else if (new Set(choices).size !== choices.length) errors.push(`${tag}: 객관식 choices 중복`);
    if (!CIRCLED.slice(0, choices.length).includes(answer)) errors.push(`${tag}: 객관식 answer 는 ${CIRCLED.slice(0, choices.length || 5).join('')} 중 하나여야 합니다 — "${answer}"`);
  } else if (Array.isArray(p.choices) && p.choices.length > 0) {
    errors.push(`${tag}: 주관식인데 choices 가 있습니다(객관식이면 type 을 "객관식"으로).`);
  }

  const no = Number.isFinite(p.no) ? Math.floor(p.no as number) : idx + 1;

  if (errors.length > 0) return { errors };
  return { errors, normalized: { ref, no, difficulty, type, question, choices, answer, solution } };
}

async function saveOne(input: SaveInput, opts: { dryRun: boolean; force: boolean }) {
  const problems = Array.isArray(input.problems) ? input.problems : [];
  if (problems.length === 0) die('save: problems 배열이 비었습니다.');
  const source = (input.source ?? '').trim() || '자체 제작';

  const index = buildMathTopicIndex();
  const allErrors: string[] = [];
  const normalized: NonNullable<ReturnType<typeof validateProblem>['normalized']>[] = [];
  for (let i = 0; i < problems.length; i++) {
    const v = validateProblem(problems[i], i, index);
    allErrors.push(...v.errors);
    if (v.normalized) normalized.push(v.normalized);
  }

  if (allErrors.length > 0 && !opts.force) {
    return { ok: false as const, reason: 'validation_failed', error_count: allErrors.length, errors: allErrors };
  }

  const distinctTopics = new Set(normalized.map((n) => n.ref.topicKey));
  if (opts.dryRun) {
    return {
      ok: true as const, dryRun: true, source,
      valid: normalized.length, invalid: allErrors.length,
      topics: distinctTopics.size, warnings: allErrors,
    };
  }

  const resolved = await resolveUser(input.user);
  const db = await getDb('gomijoshua');
  const col = db.collection(MATH_PROBLEMS_COLLECTION);
  const now = new Date();

  let inserted = 0, updated = 0, firstSerial = 0, lastSerial = 0;
  for (const n of normalized) {
    const key = { userId: resolved.userId, topicKey: n.ref.topicKey, no: n.no };
    const base: Record<string, unknown> = {
      교과: n.ref.교과, 대단원: n.ref.대단원, 중단원: n.ref.중단원, 소단원: n.ref.소단원,
      ...(n.ref.그룹명 ? { 그룹명: n.ref.그룹명 } : {}),
      학습주제: n.ref.학습주제,
      difficulty: n.difficulty, type: n.type, question: n.question,
      answer: n.answer, solution: n.solution, source, updatedAt: now,
    };
    const unset: Record<string, ''> = {};
    if (n.type === '객관식' && n.choices) base.choices = n.choices;
    else unset.choices = '';

    const existing = await col.findOne(key, { projection: { _id: 1 } });
    if (existing) {
      await col.updateOne(key, Object.keys(unset).length ? { $set: base, $unset: unset } : { $set: base });
      updated++;
    } else {
      const serialNo = await nextMathSerial(db);
      if (!firstSerial) firstSerial = serialNo;
      lastSerial = serialNo;
      await col.insertOne({ ...key, ...base, serialNo, createdAt: now });
      inserted++;
    }
  }

  return {
    ok: true as const, source,
    owner: resolved.name || resolved.loginId,
    inserted, updated,
    serial_range: firstSerial ? `${formatMathSerial(firstSerial)}~${formatMathSerial(lastSerial)}` : null,
    topics: distinctTopics.size,
    warnings: allErrors,
  };
}

async function cmdSave(flags: Map<string, string>) {
  const jsonPath = flags.get('json') ?? '';
  if (!jsonPath) die('save: --json <파일경로> 또는 --json - (stdin) 이 필요합니다.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const userOverride = flags.get('user');

  let raw: string;
  if (jsonPath === '-') raw = fs.readFileSync(0, 'utf8');
  else {
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    if (!fs.existsSync(abs)) die(`파일 없음: ${abs}`);
    raw = fs.readFileSync(abs, 'utf8');
  }
  const parsed = parseJsonInput(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) die('save: JSON 객체가 필요합니다.');
  const input = parsed as SaveInput;
  if (userOverride) input.user = userOverride;

  const result = await saveOne(input, { dryRun, force });
  out(result);
  if (!result.ok) process.exit(2);
}

async function cmdSaveAll(positional: string[], flags: Map<string, string>) {
  if (positional.length === 0) die('save-all: 1개 이상의 JSON 파일 경로를 지정하세요.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const userOverride = flags.get('user');
  const results: unknown[] = [];
  let okCount = 0, failCount = 0;
  for (const p of positional) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) { results.push({ file: p, ok: false, reason: 'not_found' }); failCount++; continue; }
    try {
      const parsed = parseJsonInput(fs.readFileSync(abs, 'utf8')) as SaveInput;
      if (userOverride) parsed.user = userOverride;
      const r = await saveOne(parsed, { dryRun, force });
      results.push({ file: p, ...r });
      if (r.ok) okCount++; else failCount++;
    } catch (e) {
      results.push({ file: p, ok: false, reason: 'exception', message: e instanceof Error ? e.message : String(e) });
      failCount++;
    }
  }
  out({ ok: failCount === 0, total: positional.length, ok_count: okCount, fail_count: failCount, results });
  if (failCount > 0) process.exit(2);
}

// ── 단축 해석 + 진입점 ──────────────────────────────────────────────────────────

function resolveShorthand(cmd: string, tail: string[]): { cmd: string; tail: string[] } {
  const known = new Set(['curricula', 'topics', 'shortage', 'save', 'save-all']);
  if (!known.has(cmd) && !cmd.startsWith('--')) {
    return { cmd: 'topics', tail: ['--textbook', cmd, ...tail] };
  }
  return { cmd, tail };
}

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (path.basename(first) === 'cc-math-cli.ts' || path.basename(first) === 'cc-math-cli.js') return raw.slice(1);
  return raw;
}

async function main() {
  const argv = argvAfterScript();
  let cmd = argv[0];
  const tail = argv.slice(1);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npm run cc:math -- <명령> [옵션]

명령:
  curricula                                    교과 목록(학교급·주제 수)
  topics   --textbook "교과명" [--user U] [--limit N]   리프 학습주제 topicKey 목록(+보유 수)
  shortage --textbook "교과명"  --user U [--limit N]     문제 0개인 학습주제만
  save     --json <파일|->  [--dry-run] [--force] [--user U]
  save-all draft1.json ...   [--dry-run] [--force] [--user U]

단축:
  "교과명"  →  topics --textbook "교과명"

원칙:
  - API 키 호출 없음. 채팅에서 문항(문제·정답·풀이) JSON 작성 → save 가 검증·저장.
  - topicKey 는 트리와 정확히 일치해야 클릭 연동됨(검증에서 강제).
  - (userId, topicKey, no) upsert — 재실행 안전, 신규만 M- 일련번호 발급.`);
    process.exit(cmd ? 0 : 1);
  }

  const resolved = resolveShorthand(cmd, tail);
  cmd = resolved.cmd;
  const { positional, flags } = parseFlags(resolved.tail);

  switch (cmd) {
    case 'curricula': cmdCurricula(); break;
    case 'topics':
      await listTopics((flags.get('textbook') ?? '').trim(), flags.get('user'), Math.floor(flagNum(flags, 'limit', 400)), false);
      break;
    case 'shortage':
      await listTopics((flags.get('textbook') ?? '').trim(), flags.get('user') ?? die('shortage: --user 가 필요합니다.'), Math.floor(flagNum(flags, 'limit', 400)), true);
      break;
    case 'save': await cmdSave(flags); break;
    case 'save-all': await cmdSaveAll(positional, flags); break;
    default: die(`알 수 없는 명령: ${cmd} (--help 참고)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
