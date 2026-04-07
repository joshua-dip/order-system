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
import { recordReviewLogFromClaudeCode } from '@/lib/generated-question-review-cc';

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
  const claude = cmd.match(/^claude:(.+)$/i);
  if (claude) {
    const num = claude[1].trim();
    if (!ORDER_NUMBER_SHORTHAND.test(num)) {
      die(`claude: 뒤 주문번호 형식이 아닙니다: ${num} (예: claude:BV-20260331-002)`);
    }
    return { cmd: 'shortage', tail: ['--order-number', num, ...tail] };
  }
  if (ORDER_NUMBER_SHORTHAND.test(cmd)) {
    return { cmd: 'shortage', tail: ['--order-number', cmd, ...tail] };
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) die('루트는 객체 JSON이어야 합니다.');
  const o = body as Record<string, unknown>;
  const passage_id = String(o.passage_id ?? '').trim();
  const textbook = String(o.textbook ?? '').trim();
  const source = String(o.source ?? '').trim();
  const type = String(o.type ?? '').trim();
  const qd = o.question_data;
  if (!qd || typeof qd !== 'object' || Array.isArray(qd)) die('question_data 객체가 필요합니다.');
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
  if (!saved.ok) die(saved.error);
  out(saved);
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
  let [cmd, ...tail] = argvAfterScript();
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npx tsx scripts/cc-variant-cli.ts <명령> [옵션]

명령:
  textbooks [--limit N]
  passages --textbook "이름" [--limit N]
  passage --id <ObjectId>
  shortage --textbook "이름" [--required N] [--status all|대기|완료|검수불일치] [--max-rows N]
  shortage --order-id <ObjectId> | shortage --order-number BV-… [동일 옵션]
  단축: BV-20260331-002  또는  claude:BV-20260331-002  → shortage --order-number … 와 동일
  save --json <파일|- >
  record-review --id <generated_question_id> --answer "정답 표현" [--response "풀이"] [--attempt 1]`);
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
    default:
      die(`알 수 없는 명령: ${cmd} (--help 참고)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
