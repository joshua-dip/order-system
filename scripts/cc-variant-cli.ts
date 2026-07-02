/**
 * Claude Code 전용: MCP 없이 MongoDB만 쓰는 변형문제 CLI.
 * Pro 구독으로 채팅에서 문제를 쓰고, 이 스크립트로 조회·저장하면 서버 Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI는 .env / .env.local):
 *
 *   npx tsx scripts/cc-variant-cli.ts textbooks [--limit 200]
 *   npx tsx scripts/cc-variant-cli.ts passages --textbook "교재명" [--limit 40]
 *   npx tsx scripts/cc-variant-cli.ts passage --id <passage_id>
 *   npx tsx scripts/cc-variant-cli.ts shortage --textbook "교재명" [--required 3] [--status all|대기|완료] [--max-rows 200]
 *   npx tsx scripts/cc-variant-cli.ts shortage --order-id <주문ObjectId> [...]
 *   npx tsx scripts/cc-variant-cli.ts shortage --order-number BV-20260331-002 [...]
 *   단축: 주문번호만 또는 claude: 접두 (부족 분 shortage 와 동일)
 *   npx tsx scripts/cc-variant-cli.ts BV-20260331-002
 *   npx tsx scripts/cc-variant-cli.ts claude:BV-20260331-002 [--required 3] [--status all|대기|완료|검수불일치]
 *   npm run claude -- claude:BV-20260331-002
 *   npx tsx scripts/cc-variant-cli.ts save --json path/to/question.json
 *   cat question.json | npx tsx scripts/cc-variant-cli.ts save --json -
 *   record-review --id <generated_question_id> --answer "2" --response "풀이 요약" [--attempt 1]
 *   record-review-bulk --textbook "교재명" [--dry-run]  — 대기 문항마다 DB 정답으로 record-review(검수 로그+완료)
 *
 * save용 JSON 예시:
 *   { "passage_id","textbook","source","type","question_data":{...}, "status":"대기", "option_type":"English" }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  runQuestionCountValidation,
  sliceQuestionCountPayloadForApi,
} from '@/lib/question-count-validation';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';
import {
  getQuestionDataForReview,
  recordReviewLogFromClaudeCode,
} from '@/lib/generated-question-review-cc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

function parseFlags(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function out(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** XX-YYYYMMDD-일련 (주문번호) */
const ORDER_NUMBER_SHORTHAND = /^[A-Za-z]{2}-\d{8}-\d+$/;

function resolveShorthandCommand(
  cmd: string,
  tail: string[]
): { cmd: string; tail: string[] } {
  const pipeline = cmd.match(/^pipeline:(.+)$/i);
  if (pipeline) {
    const num = pipeline[1].trim();
    if (!ORDER_NUMBER_SHORTHAND.test(num)) {
      die(`pipeline: 뒤 주문번호 형식이 아닙니다: ${num} (예: pipeline:BV-20260529-002)`);
    }
    return { cmd: 'pipeline', tail: ['--order-number', num, ...tail] };
  }
  const split = cmd.match(/^split:(.+)$/i);
  if (split) {
    const num = split[1].trim();
    if (!ORDER_NUMBER_SHORTHAND.test(num)) {
      die(`split: 뒤 주문번호 형식이 아닙니다: ${num} (예: split:MV-20260630-001)`);
    }
    return { cmd: 'split', tail: ['--order-number', num, ...tail] };
  }
  // claude:BV-… 는 backward-compat: shortage 로만 라우팅 (변경 없음)
  const claude = cmd.match(/^claude:(.+)$/i);
  if (claude) {
    const num = claude[1].trim();
    if (!ORDER_NUMBER_SHORTHAND.test(num)) {
      die(`claude: 뒤 주문번호 형식이 아닙니다: ${num} (예: claude:BV-20260331-002)`);
    }
    return { cmd: 'shortage', tail: ['--order-number', num, ...tail] };
  }
  // 주문번호만 입력하면 pipeline 전체 흐름으로 라우팅 (검수까지 한 번에)
  if (ORDER_NUMBER_SHORTHAND.test(cmd)) {
    return { cmd: 'pipeline', tail: ['--order-number', cmd, ...tail] };
  }
  return { cmd, tail };
}

function flagNum(flags: Map<string, string>, key: string, fallback: number): number {
  const v = flags.get(key);
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${key} 는 숫자여야 합니다.`);
  return n;
}

/** --passages "id,id,…" → Set<string> (없으면 null). 병렬 샤드 범위 지정용. */
function parsePassagesFlag(flags: Map<string, string>): Set<string> | null {
  const raw = (flags.get('passages') ?? '').trim();
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

async function cmdTextbooks(flags: Map<string, string>) {
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 200))));
  const db = await getDb('gomijoshua');
  const names = await db.collection('passages').distinct('textbook');
  const sorted = names
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const list = sorted.slice(0, lim);
  out({ ok: true, count: list.length, total_distinct: sorted.length, textbooks: list });
}

async function cmdPassages(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('passages: --textbook "교재명" 이 필요합니다.');
  const lim = Math.min(100, Math.max(1, Math.floor(flagNum(flags, 'limit', 40))));
  const db = await getDb('gomijoshua');
  const items = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .limit(lim)
    .toArray();
  out({
    ok: true,
    count: items.length,
    passages: items.map((p) => ({
      passage_id: String(p._id),
      textbook: p.textbook ?? '',
      chapter: p.chapter ?? '',
      number: p.number ?? '',
      source_key: p.source_key ?? '',
    })),
  });
}

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id || !ObjectId.isValid(id)) die('passage: --id <유효한 ObjectId> 가 필요합니다.');
  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!p) die('passage를 찾을 수 없습니다.');
  const content =
    p.content && typeof p.content === 'object' && !Array.isArray(p.content)
      ? (p.content as Record<string, unknown>)
      : {};
  out({
    ok: true,
    passage_id: String(p._id),
    textbook: String(p.textbook ?? ''),
    source_key: String(p.source_key ?? ''),
    passage_source: String(p.passage_source ?? ''),
    chapter: p.chapter ?? '',
    number: p.number ?? '',
    content,
  });
}

async function cmdShortage(flags: Map<string, string>) {
  const textbookParam = (flags.get('textbook') ?? '').trim();
  const orderIdRaw = (flags.get('order-id') ?? '').trim();
  const orderNumberRaw = (flags.get('order-number') ?? '').trim();
  if (orderIdRaw && orderNumberRaw) die('shortage: --order-id 와 --order-number 는 함께 쓸 수 없습니다.');
  if (!textbookParam && !orderIdRaw && !orderNumberRaw) {
    die('shortage: --textbook 또는 --order-id 또는 --order-number 중 하나가 필요합니다.');
  }
  const requiredPerType = Math.floor(flagNum(flags, 'required', 3));
  const questionStatusRaw = flags.get('status') ?? null;
  const maxRows = Math.min(2000, Math.max(20, Math.floor(flagNum(flags, 'max-rows', 200))));

  const result = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw: String(requiredPerType),
    questionStatusRaw,
  });
  if (!result.ok) {
    const err =
      typeof result.body.error === 'string' ? result.body.error : JSON.stringify(result.body);
    die(err);
  }
  out(sliceQuestionCountPayloadForApi(result, maxRows));
}

async function cmdNextEmpty(flags: Map<string, string>) {
  const textbookParam = (flags.get('textbook') ?? '').trim();
  const orderIdRaw = (flags.get('order-id') ?? '').trim();
  const orderNumberRaw = (flags.get('order-number') ?? '').trim();
  if (orderIdRaw && orderNumberRaw) die('next-empty: --order-id 와 --order-number 는 함께 쓸 수 없습니다.');
  if (!textbookParam && !orderIdRaw && !orderNumberRaw) {
    die('next-empty: --textbook 또는 --order-id 또는 --order-number 중 하나가 필요합니다.');
  }
  const requiredPerType = Math.floor(flagNum(flags, 'required', 3));
  const onlyType = (flags.get('only-type') ?? '').trim();
  const seedRaw = (flags.get('seed') ?? '').trim();

  const result = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw: String(requiredPerType),
    questionStatusRaw: null,
  });
  if (!result.ok) {
    const err =
      typeof result.body.error === 'string' ? result.body.error : JSON.stringify(result.body);
    die(err);
  }
  const d = result as unknown as {
    textbook?: string;
    typesChecked?: string[];
    requiredPerType?: number;
    underfilled?: Array<{ passageId: string; type: string; shortBy: number; label?: string }>;
    noQuestions?: Array<{
      passageId: string;
      label?: string;
      source_key?: string;
      chapter?: string;
      number?: string;
    }>;
  };
  const typesChecked: string[] = Array.isArray(d.typesChecked) ? d.typesChecked : [];
  const reqPerType = Number(d.requiredPerType) || requiredPerType;
  const underfilled = Array.isArray(d.underfilled) ? d.underfilled : [];
  const noQuestions = Array.isArray(d.noQuestions) ? d.noQuestions : [];

  type Slot = {
    passage_id: string;
    type: string;
    shortBy: number;
    label: string;
    source_key?: string;
    chapter?: string;
    number?: string;
  };
  const slots: Slot[] = [];
  for (const u of underfilled) {
    if (onlyType && u.type !== onlyType) continue;
    if (Number(u.shortBy) > 0) {
      slots.push({
        passage_id: String(u.passageId),
        type: String(u.type),
        shortBy: Number(u.shortBy),
        label: u.label ?? '',
      });
    }
  }
  for (const p of noQuestions) {
    for (const t of typesChecked) {
      if (onlyType && t !== onlyType) continue;
      slots.push({
        passage_id: String(p.passageId),
        type: t,
        shortBy: reqPerType,
        label: p.label ?? p.source_key ?? '',
        source_key: p.source_key,
        chapter: p.chapter,
        number: p.number,
      });
    }
  }

  if (slots.length === 0) {
    out({ ok: true, done: true, textbook: String(d.textbook ?? '') });
    return;
  }

  let pickIdx: number;
  if (seedRaw) {
    let h = 0;
    for (let i = 0; i < seedRaw.length; i++) h = (h * 31 + seedRaw.charCodeAt(i)) >>> 0;
    pickIdx = h % slots.length;
  } else {
    pickIdx = Math.floor(Math.random() * slots.length);
  }
  const picked = slots[pickIdx];

  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(picked.passage_id) });
  const content =
    p && p.content && typeof p.content === 'object' && !Array.isArray(p.content)
      ? (p.content as Record<string, unknown>)
      : {};
  out({
    ok: true,
    done: false,
    textbook: String(d.textbook ?? p?.textbook ?? ''),
    counts: {
      totalSlotsLeft: slots.length,
      typesChecked,
      requiredPerType: reqPerType,
    },
    next: {
      passage_id: picked.passage_id,
      type: picked.type,
      shortBy: picked.shortBy,
      label: picked.label,
      source_key: picked.source_key ?? String(p?.source_key ?? ''),
      chapter: picked.chapter ?? String(p?.chapter ?? ''),
      number: picked.number ?? String(p?.number ?? ''),
      passage: {
        textbook: String(p?.textbook ?? ''),
        source_key: String(p?.source_key ?? ''),
        passage_source: String(p?.passage_source ?? ''),
        content,
      },
    },
  });
}

async function cmdSave(flags: Map<string, string>) {
  const jsonPath = flags.get('json') ?? '';
  if (!jsonPath) die('save: --json <파일경로> 또는 --json - (stdin) 이 필요합니다.');
  let raw: string;
  if (jsonPath === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    if (!fs.existsSync(abs)) die(`파일 없음: ${abs}`);
    raw = fs.readFileSync(abs, 'utf8');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    die('JSON 파싱 실패');
  }
  if (!body || typeof body !== 'object') die('JSON 객체 또는 배열이 필요합니다.');

  const items: Record<string, unknown>[] = Array.isArray(body) ? body as Record<string, unknown>[] : [body as Record<string, unknown>];
  if (items.length === 0) die('빈 배열입니다.');

  const results: unknown[] = [];
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    if (!o || typeof o !== 'object' || Array.isArray(o)) { results.push({ index: i, ok: false, error: '객체가 아닙니다' }); continue; }
    const passage_id = String(o.passage_id ?? '').trim();
    const textbook = String(o.textbook ?? '').trim();
    const source = String(o.source ?? '').trim();
    const type = String(o.type ?? '').trim();
    const qd = o.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) { results.push({ index: i, ok: false, error: 'question_data 객체가 필요합니다' }); continue; }
    const status = o.status != null ? String(o.status) : undefined;
    const option_type = o.option_type != null ? String(o.option_type) : undefined;

    const saved = await saveGeneratedQuestionToDb({
      passage_id,
      textbook,
      source,
      type,
      question_data: qd as Record<string, unknown>,
      status,
      option_type,
    });
    results.push({ index: i, ...saved });
    if (items.length > 1) console.error(`  [${i + 1}/${items.length}] ${source} / ${type} → ${saved.ok ? 'OK' : saved.error}`);
  }
  if (items.length === 1) { out(results[0]); } else { out({ ok: true, total: items.length, saved: results.filter((r) => (r as { ok?: boolean }).ok).length, results }); }
}

async function cmdRecordReview(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  const answer = flags.get('answer') ?? '';
  const response = (flags.get('response') ?? '').trim() || '(검수 기록)';
  const attempt = Math.floor(flagNum(flags, 'attempt', 1));
  if (!id || !ObjectId.isValid(id)) die('record-review: --id <유효한 ObjectId> 가 필요합니다.');
  if (!answer.trim()) die('record-review: --answer 가 필요합니다.');
  const result = await recordReviewLogFromClaudeCode({
    generated_question_id: id,
    claude_answer: answer,
    claude_response: response,
    admin_login_id: null,
    attemptNumber: attempt,
  });
  out(result);
}

async function cmdRecordReviewBulk(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('record-review-bulk: --textbook "교재명" 이 필요합니다.');
  const dryRun = (flags.get('dry-run') ?? '') === 'true';

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const docs = await col
    .find({ status: '대기', textbook })
    .sort({ created_at: 1 })
    .toArray();
  const result = await recordReviewLoop(docs, { dryRun, label: textbook });
  out({ ok: true, textbook, dryRun, ...result });
}

type ReviewLoopResult = {
  total: number;
  completed: number;
  forced_mismatch_by_validation: number;
  skipped_no_correct_answer: number;
  failed: { id: string; error?: string; is_correct?: boolean | null }[];
};

async function recordReviewLoop(
  docs: Record<string, unknown>[],
  opts: { dryRun: boolean; label: string },
): Promise<ReviewLoopResult> {
  const r: ReviewLoopResult = {
    total: docs.length,
    completed: 0,
    forced_mismatch_by_validation: 0,
    skipped_no_correct_answer: 0,
    failed: [],
  };
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const id = String(doc._id);
    const { correctAnswer } = getQuestionDataForReview(doc.question_data);
    if (!correctAnswer.trim()) {
      r.skipped_no_correct_answer += 1;
      continue;
    }
    if (opts.dryRun) {
      r.completed += 1;
      continue;
    }
    const result = await recordReviewLogFromClaudeCode({
      generated_question_id: id,
      claude_answer: correctAnswer,
      claude_response:
        '(파이프라인) DB 정답으로 record-review — cc-variant-cli pipeline/record-review-bulk',
      admin_login_id: 'cc-variant-pipeline',
      attemptNumber: 1,
    });
    if (!result.ok) {
      r.failed.push({ id, error: result.error });
      continue;
    }
    if (result.forced_mismatch_by_validation) r.forced_mismatch_by_validation += 1;
    if (result.status_updated_to_complete) r.completed += 1;
    else if (result.is_correct !== true && !result.forced_mismatch_by_validation) {
      r.failed.push({ id, is_correct: result.is_correct });
    }
    if ((i + 1) % 50 === 0) {
      console.error(`  review[${opts.label}]: ${i + 1}/${docs.length}…`);
    }
  }
  return r;
}

type QCountUnderfilledLite = {
  passageId: string;
  type: string;
  shortBy: number;
  label?: string;
};

type QCountNoQuestionLite = {
  passageId: string;
  textbook?: string;
  label?: string;
};

async function cmdPipeline(flags: Map<string, string>) {
  const orderNumberRaw = (flags.get('order-number') ?? '').trim();
  const orderIdRaw = (flags.get('order-id') ?? '').trim();
  const textbookParam = (flags.get('textbook') ?? '').trim();
  if (!orderNumberRaw && !orderIdRaw && !textbookParam) {
    die('pipeline: --order-number BV-… 또는 --order-id … 또는 --textbook "이름" 중 하나가 필요합니다.');
  }
  const requiredPerType = Math.floor(flagNum(flags, 'required', 3));
  const skipReview = (flags.get('skip-review') ?? '') === 'true';
  const dryRun = (flags.get('dry-run') ?? '') === 'true';
  const maxRows = Math.min(2000, Math.max(20, Math.floor(flagNum(flags, 'max-rows', 200))));

  // 1) shortage 조회 (textbook 또는 주문 단위 자동 라우팅)
  const shortageRes = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw: String(requiredPerType),
    questionStatusRaw: null,
  });
  if (!shortageRes.ok) {
    const err =
      typeof shortageRes.body.error === 'string'
        ? shortageRes.body.error
        : JSON.stringify(shortageRes.body);
    die(`pipeline: shortage 실패 — ${err}`);
  }
  const sliced = sliceQuestionCountPayloadForApi(shortageRes, maxRows) as Record<string, unknown>;
  const textbook = String((sliced.textbook as string) ?? textbookParam);
  const pendingTotal = Number(sliced.pendingReviewTotal ?? 0);
  const needCreateGrandTotal = Number(sliced.needCreateGrandTotal ?? 0);
  const underfilled = (Array.isArray(sliced.underfilled)
    ? sliced.underfilled
    : []) as QCountUnderfilledLite[];
  const noQuestions = (Array.isArray(sliced.noQuestions)
    ? sliced.noQuestions
    : []) as QCountNoQuestionLite[];
  // 주문이 선택했지만 passages 에 원문이 없어 부족 집계에서 아예 빠지는 지문 —
  // needCreate 카운터에 안 잡히므로 별도로 표면화하지 않으면 「완료」로 오인된다.
  const lessonsWithoutPassage = (Array.isArray(sliced.lessonsWithoutPassage)
    ? sliced.lessonsWithoutPassage
    : []) as string[];
  const orderLessonsRequested = Number(sliced.orderLessonsRequested ?? 0);
  const orderLessonsMatched = Number(sliced.orderLessonsMatched ?? 0);

  // 샤드 처리 — --passages <id,id,…> 면 해당 지문만 범위 축소(병렬 분할 실행·검수용)
  const passagesFilter = parsePassagesFlag(flags);
  const underfilledUse = passagesFilter
    ? underfilled.filter((u) => passagesFilter.has(u.passageId))
    : underfilled;
  const noQuestionsUse = passagesFilter
    ? noQuestions.filter((p) => passagesFilter.has(p.passageId))
    : noQuestions;
  // 샤드일 때 grand total 은 샤드 범위 기준으로 재계산
  const emptyPerPassage = noQuestions.length > 0
    ? Math.round(Number(sliced.needCreateFromEmptyPassagesTotal ?? 0) / noQuestions.length)
    : 0;
  const shardNeedGrandTotal = passagesFilter
    ? underfilledUse.reduce((s, u) => s + Number(u.shortBy ?? 0), 0) + noQuestionsUse.length * emptyPerPassage
    : needCreateGrandTotal;

  // 2) 대기 자동 검수 (Pro-only · per-question 종합 검증 자동 적용)
  let review: ReviewLoopResult | { skipped: true; reason: string } = {
    skipped: true,
    reason: skipReview ? 'skip-review 옵션 지정' : '대기 0건',
  };
  if (!skipReview && pendingTotal > 0) {
    const db = await getDb('gomijoshua');
    const gqCol = db.collection('generated_questions');
    // 주문은 여러 교재에 걸칠 수 있으므로(예: MV 한 주문이 26년 6월 + 26년 3월 지문을 섞음),
    // textbook 단일 필드가 아니라 shortage 가 집계한 지문 집합(scopePassageIds)으로 검수 범위를 잡는다.
    // 그래야 「대표 교재」가 아닌 lesson 의 대기 문항이 검수에서 누락되지 않는다.
    const scopePassageIdsAll = Array.isArray(sliced.scopePassageIds)
      ? (sliced.scopePassageIds as string[]).filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    // 샤드면 자기 지문만 검수 (병렬 충돌 방지)
    const scopePassageIds = passagesFilter
      ? scopePassageIdsAll.filter((s) => passagesFilter.has(s))
      : scopePassageIdsAll;
    const isOrderScope = Boolean(orderNumberRaw || orderIdRaw);
    let pendingDocs: Record<string, unknown>[];
    let reviewLabel: string;
    if (isOrderScope && scopePassageIds.length > 0) {
      const scopeOids = scopePassageIds
        .filter((s) => ObjectId.isValid(s))
        .map((s) => new ObjectId(s));
      pendingDocs = await gqCol
        .find({
          status: '대기',
          $or: [{ passage_id: { $in: scopeOids } }, { passage_id: { $in: scopePassageIds } }],
        })
        .sort({ created_at: 1 })
        .toArray();
      reviewLabel = `${orderNumberRaw || orderIdRaw} (${scopePassageIds.length} passages)`;
    } else if (textbook) {
      pendingDocs = await gqCol
        .find({ status: '대기', textbook })
        .sort({ created_at: 1 })
        .toArray();
      reviewLabel = textbook;
    } else {
      pendingDocs = [];
      reviewLabel = 'order';
    }
    review = await recordReviewLoop(pendingDocs, { dryRun, label: reviewLabel });
  }

  // 3) 다음 작업 가이드
  const needCreateBreakdown = new Map<string, { type: string; total: number; passages: string[] }>();
  for (const u of underfilledUse) {
    const cur = needCreateBreakdown.get(u.type) ?? { type: u.type, total: 0, passages: [] };
    cur.total += Number(u.shortBy ?? 0);
    if (!cur.passages.includes(u.passageId)) cur.passages.push(u.passageId);
    needCreateBreakdown.set(u.type, cur);
  }
  const needCreateByType = [...needCreateBreakdown.values()].sort(
    (a, b) => b.total - a.total,
  );

  const nextChatSteps: string[] =
    shardNeedGrandTotal > 0
      ? [
          '1) 위 need_create_by_type 의 각 항목에 대해 variant_get_passage(passage_id) 로 원문 읽기',
          '2) variant_draft_grammar_rules 등 유형별 규칙에 맞춰 채팅에서 question_data JSON 작성',
          '3) variant_save_generated_question 으로 저장 (status=대기)',
          `4) 모두 저장한 뒤 ${orderNumberRaw ? `pipeline:${orderNumberRaw}` : 'pipeline --textbook …'} 다시 실행 → 신규 대기까지 자동 검수`,
        ]
      : lessonsWithoutPassage.length > 0
        ? ['카운트 기준 신규 생성 항목은 없지만, 아래 원문 미등록 지문이 남아 있어 주문 완료가 아닙니다.']
        : [
            '신규 생성할 항목이 없습니다. pendingReviewTotal 도 0 이면 주문 처리 완료입니다.',
          ];
  if (lessonsWithoutPassage.length > 0) {
    nextChatSteps.push(
      `⚠ 주문 선택 지문 ${lessonsWithoutPassage.length}건이 passages 에 원문 미등록이라 부족 집계에서 제외됨: ${lessonsWithoutPassage.join(' / ')}`,
      '   → /admin 원문 관리에서 해당 지문 등록(또는 지문 텍스트 확보) 후 pipeline 을 다시 실행해야 합니다.',
    );
  }

  out({
    ok: true,
    order_number: orderNumberRaw || null,
    textbook,
    counts: {
      pendingReviewTotal: pendingTotal,
      needCreateGrandTotal: shardNeedGrandTotal,
      needCreateShortBySum: Number(sliced.needCreateShortBySum ?? 0),
      needCreateFromEmptyPassagesTotal: Number(
        sliced.needCreateFromEmptyPassagesTotal ?? 0,
      ),
      ...(passagesFilter ? { shard: true, shardPassages: passagesFilter.size } : {}),
    },
    order_lessons:
      orderNumberRaw || orderIdRaw
        ? {
            requested: orderLessonsRequested,
            matched: orderLessonsMatched,
            without_passage: lessonsWithoutPassage,
          }
        : undefined,
    review,
    next_actions: {
      review_done: !skipReview && pendingTotal > 0,
      need_chat_generation: shardNeedGrandTotal > 0,
      passages_missing_original: lessonsWithoutPassage,
      empty_passages: noQuestionsUse.map((p) => ({
        passage_id: p.passageId,
        label: p.label ?? '',
      })),
      need_create_by_type: needCreateByType,
    },
    next_chat_steps: nextChatSteps,
    raw_shortage: { underfilled: underfilledUse, noQuestions: noQuestionsUse },
  });
}

/**
 * split — 주문 부족분이 threshold 초과면 지문 단위로 N 샤드로 분할(작업량 균형).
 * 각 샤드는 독립적으로 `pipeline … --passages <ids>` 로 생성·검수할 수 있어 병렬 에이전트 분배에 쓴다.
 */
async function cmdSplit(flags: Map<string, string>) {
  const orderNumberRaw = (flags.get('order-number') ?? '').trim();
  const orderIdRaw = (flags.get('order-id') ?? '').trim();
  const textbookParam = (flags.get('textbook') ?? '').trim();
  if (!orderNumberRaw && !orderIdRaw && !textbookParam) {
    die('split: --order-number MV-… 또는 --order-id … 또는 --textbook "이름" 중 하나가 필요합니다.');
  }
  const requiredPerType = Math.floor(flagNum(flags, 'required', 3));
  const threshold = Math.floor(flagNum(flags, 'threshold', 40));
  const perShard = Math.floor(flagNum(flags, 'per-shard', 60));
  const shardsForced = flags.get('shards') ? Math.max(1, Math.floor(flagNum(flags, 'shards', 0))) : 0;
  const maxRows = Math.min(2000, Math.max(20, Math.floor(flagNum(flags, 'max-rows', 400))));

  const shortageRes = await runQuestionCountValidation({
    textbookParam, orderIdRaw, orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw: String(requiredPerType), questionStatusRaw: null,
  });
  if (!shortageRes.ok) {
    die(`split: shortage 실패 — ${typeof shortageRes.body.error === 'string' ? shortageRes.body.error : JSON.stringify(shortageRes.body)}`);
  }
  const sliced = sliceQuestionCountPayloadForApi(shortageRes, maxRows) as Record<string, unknown>;
  const textbook = String((sliced.textbook as string) ?? textbookParam);
  const underfilled = (Array.isArray(sliced.underfilled) ? sliced.underfilled : []) as QCountUnderfilledLite[];
  const noQuestions = (Array.isArray(sliced.noQuestions) ? sliced.noQuestions : []) as QCountNoQuestionLite[];
  const emptyTotal = Number(sliced.needCreateFromEmptyPassagesTotal ?? 0);
  const emptyPer = noQuestions.length ? Math.max(1, Math.round(emptyTotal / noQuestions.length)) : 0;

  // 지문별 작업량 집계 (underfilled 유형×부족 + 빈지문 전유형)
  type Work = { passage_id: string; label: string; empty: boolean; total: number; items: { type: string; shortBy: number }[] };
  const byPassage = new Map<string, Work>();
  for (const u of underfilled) {
    const w = byPassage.get(u.passageId) ?? { passage_id: u.passageId, label: u.label ?? '', empty: false, total: 0, items: [] };
    w.items.push({ type: u.type, shortBy: Number(u.shortBy ?? 0) });
    w.total += Number(u.shortBy ?? 0);
    if (!w.label && u.label) w.label = u.label;
    byPassage.set(u.passageId, w);
  }
  for (const p of noQuestions) {
    const ex = byPassage.get(p.passageId);
    if (ex) { ex.empty = true; continue; }
    byPassage.set(p.passageId, { passage_id: p.passageId, label: p.label ?? '', empty: true, total: emptyPer, items: [{ type: '(빈지문·주문 전유형)', shortBy: emptyPer }] });
  }
  const works = [...byPassage.values()].sort((a, b) => b.total - a.total);
  const grand = works.reduce((s, w) => s + w.total, 0);

  if (grand <= threshold || works.length <= 1) {
    out({
      ok: true, parallel: false, order_number: orderNumberRaw || null, textbook,
      grand_total: grand, threshold, work_passages: works.length,
      recommend: orderNumberRaw ? `npm run cc:variant -- pipeline:${orderNumberRaw}` : 'pipeline --textbook …',
      note: 'threshold 이하 — 단일 처리 권장(병렬 불필요)',
    });
    return;
  }

  // 작업량 기준 그리디 분배 (큰 지문부터 가장 적은 샤드에)
  const shardsN = shardsForced > 0 ? shardsForced : Math.max(2, Math.ceil(grand / Math.max(1, perShard)));
  const shards = Array.from({ length: shardsN }, () => ({ passages: [] as Work[], total: 0 }));
  for (const w of works) {
    const s = shards.reduce((m, x) => (x.total < m.total ? x : m));
    s.passages.push(w);
    s.total += w.total;
  }
  const used = shards.filter((s) => s.passages.length > 0);

  out({
    ok: true, parallel: true, order_number: orderNumberRaw || null, textbook,
    grand_total: grand, threshold, shard_count: used.length, work_passages: works.length,
    shards: used.map((s, i) => ({
      index: i + 1,
      total: s.total,
      passage_count: s.passages.length,
      passage_ids: s.passages.map((p) => p.passage_id),
      passages: s.passages.map((p) => ({ passage_id: p.passage_id, label: p.label, empty: p.empty, total: p.total, items: p.items })),
      recheck_cmd: `npm run cc:variant -- pipeline:${orderNumberRaw} --passages ${s.passages.map((p) => p.passage_id).join(',')} --skip-review true`,
    })),
    final_review_cmd: orderNumberRaw ? `npm run cc:variant -- pipeline:${orderNumberRaw}` : 'pipeline --textbook …',
  });
}

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (
    first.endsWith('cc-variant-cli.ts') ||
    first.endsWith('cc-variant-cli.js') ||
    path.basename(first) === 'cc-variant-cli.ts' ||
    path.basename(first) === 'cc-variant-cli.js'
  ) {
    return raw.slice(1);
  }
  return raw;
}

async function main() {
  const argv = argvAfterScript();
  let cmd = argv[0] ?? '';
  const tail = argv.slice(1);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npx tsx scripts/cc-variant-cli.ts <명령> [옵션]

명령:
  textbooks [--limit N]
  passages --textbook "이름" [--limit N]
  passage --id <ObjectId>
  shortage --textbook "이름" [--required N] [--status all|대기|완료|검수불일치] [--max-rows N]
  shortage --order-id <ObjectId> | shortage --order-number BV-… [동일 옵션]
  pipeline --order-number BV-… [--required N] [--skip-review true] [--dry-run true]   shortage + 대기 자동 검수 + 신규 생성 가이드
  pipeline --textbook "이름" [...]
  next-empty --order-number BV-… [--required N] [--only-type 어법] [--seed <문자열>]   다음 작성 슬롯 1개 (passage_id + type + shortBy + 본문) 반환, 다 채웠으면 {done:true}
  next-empty --textbook "이름" [동일 옵션]
  단축: BV-20260529-002          → pipeline --order-number … (검수까지 한 번에)
        pipeline:BV-20260529-002 → 동일 (명시적)
        claude:BV-20260331-002    → shortage 만 (기존 호환)
  save --json <파일|- >
  record-review --id <generated_question_id> --answer "정답 표현" [--response "풀이"] [--attempt 1]
  record-review-bulk --textbook "교재명" [--dry-run true]`);
    process.exit(cmd ? 0 : 1);
  }

  const resolved = resolveShorthandCommand(cmd, tail);
  cmd = resolved.cmd;
  const { flags } = parseFlags(resolved.tail);

  switch (cmd) {
    case 'textbooks':
      await cmdTextbooks(flags);
      break;
    case 'passages':
      await cmdPassages(flags);
      break;
    case 'passage':
      await cmdPassage(flags);
      break;
    case 'shortage':
      await cmdShortage(flags);
      break;
    case 'save':
      await cmdSave(flags);
      break;
    case 'record-review':
      await cmdRecordReview(flags);
      break;
    case 'record-review-bulk':
      await cmdRecordReviewBulk(flags);
      break;
    case 'pipeline':
      await cmdPipeline(flags);
      break;
    case 'split':
      await cmdSplit(flags);
      break;
    case 'next-empty':
      await cmdNextEmpty(flags);
      break;
    default:
      die(`알 수 없는 명령: ${cmd} (--help 참고)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
