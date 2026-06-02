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
import { config } from 'dotenv';
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
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

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
  if (items.length === 1) { out(results[0]); } else { out({ ok: true, total: items.length, saved: results.filter((r: any) => r.ok).length, results }); }
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

  // 2) 대기 자동 검수 (Pro-only · per-question 종합 검증 자동 적용)
  let review: ReviewLoopResult | { skipped: true; reason: string } = {
    skipped: true,
    reason: skipReview ? 'skip-review 옵션 지정' : '대기 0건',
  };
  if (!skipReview && pendingTotal > 0) {
    const db = await getDb('gomijoshua');
    const gqCol = db.collection('generated_questions');
    let pendingDocs: Record<string, unknown>[];
    if (textbook) {
      pendingDocs = await gqCol
        .find({ status: '대기', textbook })
        .sort({ created_at: 1 })
        .toArray();
    } else {
      pendingDocs = [];
    }
    review = await recordReviewLoop(pendingDocs, { dryRun, label: textbook || 'order' });
  }

  // 3) 다음 작업 가이드
  const needCreateBreakdown = new Map<string, { type: string; total: number; passages: string[] }>();
  for (const u of underfilled) {
    const cur = needCreateBreakdown.get(u.type) ?? { type: u.type, total: 0, passages: [] };
    cur.total += Number(u.shortBy ?? 0);
    if (!cur.passages.includes(u.passageId)) cur.passages.push(u.passageId);
    needCreateBreakdown.set(u.type, cur);
  }
  const needCreateByType = [...needCreateBreakdown.values()].sort(
    (a, b) => b.total - a.total,
  );

  out({
    ok: true,
    order_number: orderNumberRaw || null,
    textbook,
    counts: {
      pendingReviewTotal: pendingTotal,
      needCreateGrandTotal,
      needCreateShortBySum: Number(sliced.needCreateShortBySum ?? 0),
      needCreateFromEmptyPassagesTotal: Number(
        sliced.needCreateFromEmptyPassagesTotal ?? 0,
      ),
    },
    review,
    next_actions: {
      review_done: !skipReview && pendingTotal > 0,
      need_chat_generation: needCreateGrandTotal > 0,
      empty_passages: noQuestions.map((p) => ({
        passage_id: p.passageId,
        label: p.label ?? '',
      })),
      need_create_by_type: needCreateByType,
    },
    next_chat_steps:
      needCreateGrandTotal > 0
        ? [
            '1) 위 need_create_by_type 의 각 항목에 대해 variant_get_passage(passage_id) 로 원문 읽기',
            '2) variant_draft_grammar_rules 등 유형별 규칙에 맞춰 채팅에서 question_data JSON 작성',
            '3) variant_save_generated_question 으로 저장 (status=대기)',
            `4) 모두 저장한 뒤 ${orderNumberRaw ? `pipeline:${orderNumberRaw}` : 'pipeline --textbook …'} 다시 실행 → 신규 대기까지 자동 검수`,
          ]
        : [
            '신규 생성할 항목이 없습니다. pendingReviewTotal 도 0 이면 주문 처리 완료입니다.',
          ],
    raw_shortage: { underfilled, noQuestions },
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
