/**
 * Claude Code 전용: 국어 해설지 작성·검증·저장 CLI (Pro-only, API 호출 0).
 *
 * Pro 채팅에서 BLOCK_CATALOG.md 의 13종 블록 조합 JSON 을 작성한 뒤
 * 이 스크립트로 검증·저장만 한다. Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI 는 .env / .env.local):
 *
 *   npx tsx scripts/cc-korean-explain-cli.ts textbooks
 *   npx tsx scripts/cc-korean-explain-cli.ts list [--textbook "..."] [--folder "..."] [--limit 50]
 *   npx tsx scripts/cc-korean-explain-cli.ts get --id <explanationId>
 *   npx tsx scripts/cc-korean-explain-cli.ts validate --json path/to/doc.json
 *   npx tsx scripts/cc-korean-explain-cli.ts save --json path/to/doc.json [--dry-run] [--force]
 *   cat doc.json | npx tsx scripts/cc-korean-explain-cli.ts save --json -
 *   npx tsx scripts/cc-korean-explain-cli.ts delete --id <explanationId>
 *
 *   단축: 교재명만 → list --textbook "교재명"
 *   npx tsx scripts/cc-korean-explain-cli.ts "2025학년도 3월 고1 국어 모의고사"
 *
 *   도움말: npx tsx scripts/cc-korean-explain-cli.ts --help
 *
 * save 용 JSON 스키마:
 *   {
 *     "textbook":     "2025학년도 3월 고1 국어 모의고사",
 *     "sourceKey":    "25-03-go1-22-25",
 *     "setRange":     "22-25",
 *     "genre":        "현대소설",
 *     "workTitle":    "이문구 「암소」",
 *     "examTitle":    "2025학년도 3월 고1 국어 모의고사 해설",
 *     "showSubtitle": false,
 *     "folder":       "기본",
 *     "blocks":       [ { "type": "cover", "data": {...} }, ... ]
 *   }
 *
 *  ★ `blocks` 안의 타입·필드는 BLOCK_CATALOG.md 와 lib/korean-explainer/types.ts 참고.
 *  ★ `compare_2col` 의 left_color/right_color, `emotion_flow` 의 arrow_labels.length
 *     = stages.length-1, `question` 의 answer ↔ correct_n 일치 등 validator 가 강제.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import {
  deleteKoreanExplanation,
  getKoreanExplanation,
  listKoreanExplanations,
  saveKoreanExplanation,
  updateKoreanExplanation,
} from '@/lib/korean-explanations-store';
import {
  validateKoreanExplanation,
} from '@/lib/korean-explainer/validator';
import type { Block } from '@/lib/korean-explainer/types';

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

function readJsonFromFlags(flags: Map<string, string>): unknown {
  const file = flags.get('json');
  if (!file) die('--json <path|-> 인자가 필요합니다.');
  let raw: string;
  if (file === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  }
  let text = raw.trim();
  // 코드 펜스 제거: ``` 또는 ```json
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── 입력 정규화 (save 페이로드 → 스토어 입력) ───────────────────────────────────

interface SaveInput {
  id?: string;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  showSubtitle?: boolean;
  folder?: string;
  status?: '대기' | '검수완료' | '검수불일치';
  blocks: Block[];
}

function normalizeInput(raw: unknown): SaveInput {
  if (typeof raw !== 'object' || raw === null) die('save: 객체 JSON 이 필요합니다.');
  const r = raw as Record<string, unknown>;
  const get = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  const result: SaveInput = {
    id: get('id') || undefined,
    passageId: get('passageId') || undefined,
    textbook: get('textbook'),
    sourceKey: get('sourceKey'),
    setRange: get('setRange'),
    genre: get('genre'),
    workTitle: get('workTitle'),
    examTitle: get('examTitle'),
    showSubtitle: typeof r.showSubtitle === 'boolean' ? r.showSubtitle : false,
    folder: get('folder') || '기본',
    status: (r.status === '대기' || r.status === '검수완료' || r.status === '검수불일치') ? r.status : '검수완료',
    blocks: Array.isArray(r.blocks) ? (r.blocks as Block[]) : [],
  };
  for (const k of ['textbook', 'sourceKey', 'setRange', 'genre', 'workTitle', 'examTitle'] as const) {
    if (!result[k]) die(`save: ${k} 가 비어 있습니다.`);
  }
  return result;
}

function validateForSave(input: SaveInput): string[] {
  // 메타 + blocks 둘 다 한 번에 검증
  const v = validateKoreanExplanation({
    exam_title: input.examTitle,
    set_range: input.setRange,
    genre: input.genre,
    work_title: input.workTitle,
    show_subtitle: input.showSubtitle,
    blocks: input.blocks,
  });
  return v.ok ? [] : v.errors;
}

// ── 명령어들 ────────────────────────────────────────────────────────────────

const HELP = `
국어 해설지 CLI (cc:korean-explain)

  npm run cc:korean-explain -- <command> [options]

명령어:
  textbooks                          저장된 해설지의 distinct 교재 목록
  list [--textbook ...] [--folder ...] [--limit 50]
                                    저장된 해설지 목록
  get --id <id>                      단건 조회 (blocks 포함)
  validate --json <path|->            JSON 검증만 (저장 X)
  save --json <path|-> [--dry-run] [--force]
                                    검증 → insert/update. dry-run 시 저장 X.
                                    id 필드가 있으면 update.
                                    --force 는 향후 보안 검증 우회용 (현재 미사용).
  delete --id <id>                   삭제

단축:
  npm run cc:korean-explain -- "교재명"   → list --textbook "교재명"

JSON 스키마 키:
  textbook · sourceKey · setRange · genre · workTitle · examTitle · folder · blocks[]
  (각 block 은 BLOCK_CATALOG.md 의 13종 타입 + data 구조. lib/korean-explainer/types.ts 참고)

문학(현대소설/현대시/고전시가/고전소설) 데이터는 외부 정리물 import 가 결정된 뒤
별도 epic 에서 처리한다 (PLAN-korean-explainer.md §0-2).
`.trim();

async function cmdTextbooks() {
  const db = await getDb('gomijoshua');
  const names = await db.collection('korean_explanations').distinct('textbook');
  const sorted = (names as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim())
    .sort((a, b) => a.localeCompare(b, 'ko'));
  out({ count: sorted.length, textbooks: sorted });
}

async function cmdList(flags: Map<string, string>) {
  const textbook = flags.get('textbook') || undefined;
  const folder = flags.get('folder') || undefined;
  const limit = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 50))));
  const items = await listKoreanExplanations({ textbook, folder });
  out({
    count: items.length,
    items: items.slice(0, limit).map(it => ({
      _id: it._id,
      setRange: it.setRange,
      genre: it.genre,
      workTitle: it.workTitle,
      sourceKey: it.sourceKey,
      textbook: it.textbook,
      folder: it.folder,
      status: it.status,
      blockCount: it.blockCount,
      updatedAt: it.updatedAt,
    })),
  });
}

async function cmdGet(flags: Map<string, string>) {
  const id = flags.get('id');
  if (!id) die('get: --id <explanationId> 가 필요합니다.');
  const doc = await getKoreanExplanation(id);
  if (!doc) die(`get: id=${id} 해설지가 없습니다.`);
  out(doc);
}

async function cmdValidate(flags: Map<string, string>) {
  const raw = readJsonFromFlags(flags);
  const input = normalizeInput(raw);
  const errors = validateForSave(input);
  if (errors.length === 0) {
    out({ ok: true, blockCount: input.blocks.length, message: '✓ 검증 통과' });
  } else {
    out({ ok: false, blockCount: input.blocks.length, errors });
    process.exit(2);
  }
}

async function cmdSave(flags: Map<string, string>) {
  const dryRun = flagBool(flags, 'dry-run');
  const raw = readJsonFromFlags(flags);
  const input = normalizeInput(raw);
  const errors = validateForSave(input);
  if (errors.length > 0) {
    out({ ok: false, action: 'validate', errors });
    process.exit(2);
  }
  if (dryRun) {
    out({ ok: true, action: 'dry-run', blockCount: input.blocks.length, textbook: input.textbook, setRange: input.setRange });
    return;
  }

  if (input.id) {
    const ok = await updateKoreanExplanation(input.id, {
      passageId: input.passageId,
      textbook: input.textbook,
      sourceKey: input.sourceKey,
      setRange: input.setRange,
      genre: input.genre,
      workTitle: input.workTitle,
      examTitle: input.examTitle,
      showSubtitle: input.showSubtitle,
      folder: input.folder ?? '기본',
      status: input.status ?? '검수완료',
      blocks: input.blocks,
      createdBy: 'cc:korean-explain',
    });
    if (!ok) die(`save: id=${input.id} 가 없습니다.`);
    out({ ok: true, action: 'update', id: input.id, blockCount: input.blocks.length });
    return;
  }

  const newId = await saveKoreanExplanation({
    passageId: input.passageId,
    textbook: input.textbook,
    sourceKey: input.sourceKey,
    setRange: input.setRange,
    genre: input.genre,
    workTitle: input.workTitle,
    examTitle: input.examTitle,
    showSubtitle: input.showSubtitle,
    folder: input.folder ?? '기본',
    status: input.status ?? '검수완료',
    blocks: input.blocks,
    createdBy: 'cc:korean-explain',
  });
  out({ ok: true, action: 'insert', id: newId, blockCount: input.blocks.length });
}

async function cmdDelete(flags: Map<string, string>) {
  const id = flags.get('id');
  if (!id) die('delete: --id <explanationId> 가 필요합니다.');
  const ok = await deleteKoreanExplanation(id);
  if (!ok) die(`delete: id=${id} 가 없습니다.`);
  out({ ok: true, action: 'delete', id });
}

// ── 디스패처 ─────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const { positional, flags } = parseFlags(argv);
  const cmd = positional[0] ?? '';

  // 단축: 교재명만 → list --textbook
  if (cmd && !['textbooks', 'list', 'get', 'validate', 'save', 'delete'].includes(cmd)) {
    flags.set('textbook', cmd);
    await cmdList(flags);
    return;
  }

  switch (cmd) {
    case 'textbooks': await cmdTextbooks(); break;
    case 'list': await cmdList(flags); break;
    case 'get': await cmdGet(flags); break;
    case 'validate': await cmdValidate(flags); break;
    case 'save': await cmdSave(flags); break;
    case 'delete': await cmdDelete(flags); break;
    default:
      console.error(`알 수 없는 명령: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
