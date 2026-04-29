/**
 * Claude Code 전용: MCP 없이 MongoDB만 쓰는 「블록 빈칸 워크북」 CLI.
 * Pro 구독으로 채팅에서 selection JSON 을 작성하고, 이 스크립트로
 * 조회·검증·저장(+HTML 생성) 만 담당하므로 Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI는 .env / .env.local):
 *
 *   npx tsx scripts/cc-block-workbook-cli.ts textbooks [--limit 200]
 *   npx tsx scripts/cc-block-workbook-cli.ts passages --textbook "교재명" [--limit 40]
 *   npx tsx scripts/cc-block-workbook-cli.ts passage --id <ObjectId>
 *   npx tsx scripts/cc-block-workbook-cli.ts shortage --textbook "교재명"
 *                                            [--required 1]
 *                                            [--types ABCDEF]
 *                                            [--folder "..."|all]
 *   npx tsx scripts/cc-block-workbook-cli.ts save --json path/to/draft.json [--dry-run] [--force]
 *   cat draft.json | npx tsx scripts/cc-block-workbook-cli.ts save --json -
 *
 *   단축: 교재명만 → shortage --textbook "교재명"
 *   npx tsx scripts/cc-block-workbook-cli.ts "26년 3월 고1 영어모의고사"
 *
 * save 입력 JSON 스키마:
 *   {
 *     "passageId": "65fa…",      // 선택. 있으면 textbook/sourceKey 자동 보강
 *     "textbook":  "26년 3월 고1 영어모의고사",
 *     "sourceKey": "26년 3월 고1 영어모의고사 21번",
 *     "title":     "01강 핵심 표현 워크북",
 *     "folder":    "기본",
 *     "selection": {
 *        "sentences": [ {idx, text, tokens, korean?} ... ],   // passage 명령 결과
 *        "blocks":    [
 *           {sentenceIdx, startTokenIdx, endTokenIdx, kind: "word"|"phrase"|"sentence",
 *            koreanMeaning?, baseForm?}
 *        ]
 *     },
 *     "types": ["A","B","C","D","E","F"]
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { buildAllHtml } from '@/lib/block-workbook-html';
import {
  saveBlockWorkbook,
  listBlockWorkbooks,
} from '@/lib/block-workbooks-store';
import {
  validateBlockWorkbookInput,
  BlockWorkbookValidationResult,
} from '@/lib/block-workbook-validator';
import type { BlockWorkbookSelection, WorkbookKind } from '@/lib/block-workbook-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

// ── 공용 유틸 ─────────────────────────────────────────────────────────────────

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
  /* 코드 펜스 제거: ``` 또는 ```json */
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    text = text.trim();
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const VALID_TYPES: WorkbookKind[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/** "ABDF" / "A,B,D,F" / "ABCDEF" 형태를 파싱. 빈 값이면 전체. */
function parseTypesFlag(raw: string | undefined): WorkbookKind[] {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'all') {
    return [...VALID_TYPES];
  }
  const cleaned = raw.toUpperCase().replace(/[\s,]/g, '');
  const out: WorkbookKind[] = [];
  for (const ch of cleaned) {
    if (VALID_TYPES.includes(ch as WorkbookKind) && !out.includes(ch as WorkbookKind)) {
      out.push(ch as WorkbookKind);
    }
  }
  return out;
}

// ── textbooks ─────────────────────────────────────────────────────────────────

async function cmdTextbooks(flags: Map<string, string>) {
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 200))));
  const db = await getDb('gomijoshua');
  const names = await db.collection('passages').distinct('textbook');
  const sorted = (names as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim())
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const list = sorted.slice(0, lim);
  out({ ok: true, count: list.length, total_distinct: sorted.length, textbooks: list });
}

// ── passages ──────────────────────────────────────────────────────────────────

async function cmdPassages(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('passages: --textbook "교재명" 이 필요합니다.');
  const lim = Math.min(200, Math.max(1, Math.floor(flagNum(flags, 'limit', 40))));
  const db = await getDb('gomijoshua');

  const items = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .limit(lim)
    .toArray();

  /* block_workbooks 카운트 — passageId 우선, 없으면 sourceKey fallback */
  const passageIds = items.map(p => String(p._id));
  const sourceKeys = items
    .map(p => (typeof p.source_key === 'string' ? p.source_key : ''))
    .filter(Boolean);

  const wbRows = await db
    .collection('block_workbooks')
    .aggregate([
      {
        $match: {
          $or: [
            { passageId: { $in: passageIds } },
            { sourceKey: { $in: sourceKeys }, textbook },
          ],
        },
      },
      {
        $group: {
          _id: { passageId: '$passageId', sourceKey: '$sourceKey' },
          count: { $sum: 1 },
          types: { $addToSet: '$types' },
        },
      },
    ])
    .toArray();

  const countByPassageId = new Map<string, number>();
  const countBySourceKey = new Map<string, number>();
  for (const row of wbRows) {
    const k = row._id as { passageId?: string; sourceKey?: string };
    if (k.passageId) countByPassageId.set(String(k.passageId), Number(row.count));
    if (k.sourceKey && !k.passageId) {
      countBySourceKey.set(String(k.sourceKey), Number(row.count));
    }
  }

  out({
    ok: true,
    textbook,
    count: items.length,
    passages: items.map(p => {
      const pid = String(p._id);
      const sk = typeof p.source_key === 'string' ? p.source_key : '';
      const wbCount = (countByPassageId.get(pid) ?? 0) + (countBySourceKey.get(sk) ?? 0);
      return {
        passage_id: pid,
        textbook: p.textbook ?? '',
        chapter: p.chapter ?? '',
        number: p.number ?? '',
        source_key: sk,
        block_workbook_count: wbCount,
      };
    }),
  });
}

// ── passage ───────────────────────────────────────────────────────────────────

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id) die('passage: --id <ObjectId> 가 필요합니다.');
  if (!ObjectId.isValid(id)) die(`passage: 유효하지 않은 ObjectId: ${id}`);

  const db = await getDb('gomijoshua');
  const doc = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!doc) die(`passage: passages 에서 _id=${id} 를 찾을 수 없습니다.`);

  const content = (doc as { content?: { original?: string; sentences_en?: unknown; sentences_ko?: unknown } }).content;
  const sentences = tokenizePassageFromContent(content ?? null);

  out({
    ok: true,
    passage_id: String(doc._id),
    textbook: doc.textbook ?? '',
    chapter: doc.chapter ?? '',
    number: doc.number ?? '',
    source_key: doc.source_key ?? '',
    sentences,
    /** 채팅이 selection 을 만들 때 그대로 복붙해서 쓰면 되는 표 — koreanMeaning/baseForm 만 채워 넣음 */
    selection_seed: {
      sentences,
      blocks: [],
    },
    /** 도움말: 블록 인덱스 사용법 */
    notes: [
      'sentenceIdx 는 sentences[i].idx 와 같음.',
      'word 블록: startTokenIdx === endTokenIdx, length 1.',
      'phrase 블록: 2~5 인접 토큰 권장. startTokenIdx <= endTokenIdx.',
      'sentence 블록: startTokenIdx=0, endTokenIdx=tokens.length-1.',
      'sentences[i].korean 이 있으면 sentence 블록의 koreanMeaning 미입력 시 자동 fallback.',
    ],
  });
}

// ── shortage ──────────────────────────────────────────────────────────────────

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.floor(flagNum(flags, 'required', 1)));
  const folderRaw = (flags.get('folder') ?? 'all').trim();
  const requiredTypes = parseTypesFlag(flags.get('types'));

  const db = await getDb('gomijoshua');

  /* 1) 해당 교재의 모든 지문 */
  const passages = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();

  if (passages.length === 0) {
    out({
      ok: true,
      textbook,
      required,
      types: requiredTypes,
      folder: folderRaw,
      passages_total: 0,
      shortage_count: 0,
      need_create_total: 0,
      shortage: [],
    });
    return;
  }

  /* 2) 해당 교재의 block_workbooks 를 folder 필터로 가져옴 */
  const wbFilter: Record<string, unknown> = { textbook };
  if (folderRaw && folderRaw !== 'all') wbFilter.folder = folderRaw;

  const workbooks = await db
    .collection('block_workbooks')
    .find(wbFilter)
    .project({ passageId: 1, sourceKey: 1, types: 1 })
    .toArray();

  /* 3) types 필터 — 요청 types 가 모두 포함된 도큐먼트만 카운트 */
  const matched = workbooks.filter(w => {
    const t = (w as { types?: unknown }).types;
    if (!Array.isArray(t)) return false;
    return requiredTypes.every(rt => (t as WorkbookKind[]).includes(rt));
  });

  const countByPid = new Map<string, number>();
  const countBySk = new Map<string, number>();
  for (const w of matched) {
    const pid = (w as { passageId?: string }).passageId;
    const sk = (w as { sourceKey?: string }).sourceKey;
    if (pid) countByPid.set(String(pid), (countByPid.get(String(pid)) ?? 0) + 1);
    else if (sk) countBySk.set(String(sk), (countBySk.get(String(sk)) ?? 0) + 1);
  }

  /* 4) 부족 지문 추출 */
  const shortage: Array<{
    passage_id: string;
    source_key: string;
    chapter: string;
    number: string;
    have: number;
    need: number;
  }> = [];
  let totalNeed = 0;
  for (const p of passages) {
    const pid = String(p._id);
    const sk = String(p.source_key ?? '');
    const have = (countByPid.get(pid) ?? 0) + (countBySk.get(sk) ?? 0);
    if (have < required) {
      const need = required - have;
      totalNeed += need;
      shortage.push({
        passage_id: pid,
        source_key: sk,
        chapter: String(p.chapter ?? ''),
        number: String(p.number ?? ''),
        have,
        need,
      });
    }
  }

  out({
    ok: true,
    textbook,
    required,
    types: requiredTypes,
    folder: folderRaw,
    passages_total: passages.length,
    shortage_count: shortage.length,
    need_create_total: totalNeed,
    shortage,
  });
}

// ── save ─────────────────────────────────────────────────────────────────────

interface SaveInput {
  passageId?: string;
  textbook?: string;
  sourceKey?: string;
  title?: string;
  folder?: string;
  selection?: BlockWorkbookSelection;
  types?: WorkbookKind[];
}

async function cmdSave(flags: Map<string, string>) {
  const jsonPath = flags.get('json') ?? '';
  if (!jsonPath) die('save: --json <파일경로> 또는 --json - (stdin) 이 필요합니다.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');

  let raw: string;
  if (jsonPath === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    if (!fs.existsSync(abs)) die(`파일 없음: ${abs}`);
    raw = fs.readFileSync(abs, 'utf8');
  }

  const parsed = parseJsonInput(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die('save: JSON 객체가 필요합니다.');
  }
  const input = parsed as SaveInput;

  /* 1) passageId 로 textbook/sourceKey 자동 보강 (입력값 우선) */
  let textbook = (input.textbook ?? '').trim();
  let sourceKey = (input.sourceKey ?? '').trim();
  const passageId = (input.passageId ?? '').trim();

  if (passageId) {
    if (!ObjectId.isValid(passageId)) die(`save: passageId 가 유효한 ObjectId 가 아닙니다: ${passageId}`);
    const db = await getDb('gomijoshua');
    const p = await db.collection('passages').findOne({ _id: new ObjectId(passageId) });
    if (!p) die(`save: passages 에서 passageId(${passageId}) 를 찾을 수 없습니다.`);
    if (!textbook) textbook = String(p.textbook ?? '');
    if (!sourceKey) sourceKey = String(p.source_key ?? `${p.chapter ?? ''} ${p.number ?? ''}`.trim());
  }

  const title = (input.title ?? '').trim() || '블록 빈칸 워크북';
  const folder = (input.folder ?? '').trim() || '기본';
  const types = Array.isArray(input.types) ? input.types : [];

  /* 2) 검증 */
  const validation: BlockWorkbookValidationResult = validateBlockWorkbookInput({
    passageId,
    textbook,
    sourceKey,
    title,
    folder,
    selection: input.selection,
    types,
  });
  if (!validation.valid && !force) {
    out({
      ok: false,
      reason: 'validation_failed',
      hint: '오류를 고치거나 --force 로 우회하세요.',
      validation,
    });
    process.exit(2);
  }

  if (!input.selection) die('save: selection 이 필요합니다.');

  /* 3) HTML 빌드 */
  const opts = {
    title,
    textbook,
    sourceKey,
    selection: input.selection,
  };
  const html = buildAllHtml(opts, types);

  /* 4) dry-run 이면 여기서 끝 */
  if (dryRun) {
    out({
      ok: true,
      dryRun: true,
      validation,
      textbook,
      sourceKey,
      passageId: passageId || null,
      title,
      folder,
      types,
      generated_html_kinds: Object.keys(html),
      generated_html_bytes: Object.fromEntries(
        Object.entries(html).map(([k, v]) => [k, Buffer.byteLength(String(v), 'utf8')]),
      ),
      blocks_count: input.selection.blocks.length,
      sentences_count: input.selection.sentences.length,
    });
    return;
  }

  /* 5) 실제 저장 */
  const id = await saveBlockWorkbook({
    passageId: passageId || undefined,
    textbook,
    sourceKey,
    title,
    folder,
    selection: input.selection,
    types,
    html,
  });

  out({
    ok: true,
    id,
    title,
    folder,
    textbook,
    sourceKey,
    passageId: passageId || null,
    types,
    validation,
  });
}

// ── list ─────────────────────────────────────────────────────────────────────
// 디버그용. 옵션이지만 cc:essay 와 일관성 위해 추가.

async function cmdList() {
  const items = await listBlockWorkbooks();
  out({ ok: true, count: items.length, items });
}

// ── 단축 명령 해석 ────────────────────────────────────────────────────────────

function resolveShorthandCommand(
  cmd: string,
  tail: string[],
): { cmd: string; tail: string[] } {
  /* 첫 인자가 플래그가 아니고 알려진 서브커맨드도 아니면 → shortage --textbook <인자> */
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'save', 'list']);
  if (!known.has(cmd) && !cmd.startsWith('--')) {
    return { cmd: 'shortage', tail: ['--textbook', cmd, ...tail] };
  }
  return { cmd, tail };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (
    first.endsWith('cc-block-workbook-cli.ts') ||
    first.endsWith('cc-block-workbook-cli.js') ||
    path.basename(first) === 'cc-block-workbook-cli.ts' ||
    path.basename(first) === 'cc-block-workbook-cli.js'
  ) {
    return raw.slice(1);
  }
  return raw;
}

async function main() {
  const argv = argvAfterScript();
  let cmd = argv[0];
  const tail = argv.slice(1);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npx tsx scripts/cc-block-workbook-cli.ts <명령> [옵션]

명령:
  textbooks [--limit N]
  passages  --textbook "이름" [--limit N]
  passage   --id <ObjectId>
  shortage  --textbook "이름" [--required N] [--types ABCDEF|all] [--folder "..."|all]
  save      --json <파일|->  [--dry-run] [--force]
  list

단축:
  "교재명"  →  shortage --textbook "교재명"

원칙: API 키 호출 없음. 채팅에서 selection JSON 작성 → save 가 검증·HTML 생성·저장.`);
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
    case 'list':
      await cmdList();
      break;
    default:
      die(`알 수 없는 명령: ${cmd} (--help 참고)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
