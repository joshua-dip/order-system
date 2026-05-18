/**
 * Claude Code 전용: 서술형집중 워크북 CLI (Pro 채팅 + DB 저장).
 *
 * Pro 구독 채팅에서 8섹션 EssayStepWorkbookData JSON 을 작성하고, 이 스크립트로
 * 조회·검증·HTML 생성·저장 만 담당. **Anthropic API 비용 없음.**
 *
 * 프로젝트 루트에서:
 *   npx tsx scripts/cc-essay-step-cli.ts textbooks [--limit 200]
 *   npx tsx scripts/cc-essay-step-cli.ts passages --textbook "교재명" [--limit 40]
 *   npx tsx scripts/cc-essay-step-cli.ts passage --id <passageId>
 *   npx tsx scripts/cc-essay-step-cli.ts shortage --textbook "교재명" [--required 1] [--folder "..."|all]
 *   npx tsx scripts/cc-essay-step-cli.ts save --json path/to/workbook.json [--dry-run] [--force]
 *   cat workbook.json | npx tsx scripts/cc-essay-step-cli.ts save --json -
 *
 *   단축: 교재명만 → shortage --textbook "교재명"
 *   npx tsx scripts/cc-essay-step-cli.ts "26년 3월 고1 영어모의고사"
 *
 * save 용 JSON 스키마 (예시):
 *   {
 *     "passageId": "65fa…",                 // 선택. 있으면 textbook/sourceKey 자동 보강
 *     "textbook":  "26년 3월 고1 영어모의고사",
 *     "sourceKey": "26년 3월 고1 영어모의고사 21번",
 *     "folder":    "기본",
 *     "data":      <EssayStepWorkbookData 8섹션 JSON 전체>
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  buildEssayStepCombinedHtml,
  EssayStepWorkbookData,
} from '@/lib/essay-step-workbook';
import { validateEssayStepData, EssayStepValidationResult } from '@/lib/essay-step-validator';
import {
  saveEssayStepWorkbook,
  ESSAY_STEP_COL,
} from '@/lib/essay-step-workbooks-store';

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

  // essay_step_workbooks 카운트 (passageId 우선, 없으면 sourceKey fallback)
  const passageIds = items.map(p => String(p._id));
  const sourceKeys = items
    .map(p => (typeof p.source_key === 'string' ? p.source_key : ''))
    .filter(Boolean);

  const wbRows = await db
    .collection(ESSAY_STEP_COL)
    .aggregate([
      {
        $match: {
          $or: [
            { passageId: { $in: passageIds } },
            { sourceKey: { $in: sourceKeys }, textbook },
          ],
        },
      },
      { $group: { _id: { passageId: '$passageId', sourceKey: '$sourceKey' }, count: { $sum: 1 } } },
    ])
    .toArray();

  const countByPid = new Map<string, number>();
  const countBySk = new Map<string, number>();
  for (const r of wbRows) {
    const k = r._id as { passageId?: string; sourceKey?: string };
    if (k.passageId) countByPid.set(String(k.passageId), Number(r.count));
    else if (k.sourceKey) countBySk.set(String(k.sourceKey), Number(r.count));
  }

  out({
    ok: true,
    textbook,
    count: items.length,
    passages: items.map(p => {
      const pid = String(p._id);
      const sk = typeof p.source_key === 'string' ? p.source_key : '';
      const wbCount = (countByPid.get(pid) ?? 0) + (countBySk.get(sk) ?? 0);
      return {
        passage_id: pid,
        textbook: p.textbook ?? '',
        chapter: p.chapter ?? '',
        number: p.number ?? '',
        source_key: sk,
        essay_step_workbook_count: wbCount,
      };
    }),
  });
}

// ── passage ───────────────────────────────────────────────────────────────────

interface SentenceRow { idx: number; text: string; korean: string; }

function parseSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id || !ObjectId.isValid(id)) die('passage: --id <유효한 ObjectId> 가 필요합니다.');

  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!p) die('passage 를 찾을 수 없습니다.');

  const content =
    p.content && typeof p.content === 'object' && !Array.isArray(p.content)
      ? (p.content as Record<string, unknown>)
      : {};
  const original = String(content.original ?? '');
  const translation = String(content.translation ?? '');

  const sentences_en = Array.isArray(content.sentences_en)
    ? (content.sentences_en as unknown[]).map(v => String(v ?? '').trim()).filter(Boolean)
    : parseSentences(original);
  const sentences_ko = Array.isArray(content.sentences_ko)
    ? (content.sentences_ko as unknown[]).map(v => String(v ?? '').trim())
    : [];

  const rows: SentenceRow[] = sentences_en.map((text, idx) => ({
    idx,
    text,
    korean: sentences_ko[idx] ?? '',
  }));

  // 기존 워크북 카운트
  const sk = String(p.source_key ?? '');
  const existingCount = await db.collection(ESSAY_STEP_COL).countDocuments({
    $or: [
      { passageId: id },
      ...(sk ? [{ sourceKey: sk, textbook: String(p.textbook ?? '') }] : []),
    ],
  });

  // 채팅 친화 표 (stderr)
  const tableLines = rows.map(r => {
    const ko = r.korean ? `\n      KO: ${r.korean}` : '';
    return `[${String(r.idx).padStart(2, ' ')}]  ${r.text}${ko}`;
  });
  const printable = [
    `## 지문 정보`,
    `- passage_id : ${id}`,
    `- textbook   : ${String(p.textbook ?? '')}`,
    `- source_key : ${sk}`,
    `- chapter    : ${String(p.chapter ?? '')}`,
    `- number     : ${String(p.number ?? '')}`,
    `- essay_step_workbooks: ${existingCount}건`,
    ``,
    `## 문장 (EN + KO)`,
    ...tableLines,
  ].join('\n');
  console.error(printable);

  out({
    ok: true,
    passage_id: id,
    textbook: String(p.textbook ?? ''),
    sourceKey: sk,
    chapter: p.chapter ?? '',
    number: p.number ?? '',
    essay_step_workbook_count: existingCount,
    original,
    translation,
    sentences: rows,
  });
}

// ── shortage ──────────────────────────────────────────────────────────────────

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.floor(flagNum(flags, 'required', 1)));
  const folderRaw = (flags.get('folder') ?? 'all').trim();

  const db = await getDb('gomijoshua');
  const passages = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();
  if (passages.length === 0) {
    out({ ok: true, textbook, required, folder: folderRaw, total: 0, shortage: [] });
    return;
  }

  const wbFilter: Record<string, unknown> = { textbook };
  if (folderRaw && folderRaw !== 'all') wbFilter.folder = folderRaw;

  const wbs = await db
    .collection(ESSAY_STEP_COL)
    .find(wbFilter)
    .project({ passageId: 1, sourceKey: 1 })
    .toArray();

  const countByPid = new Map<string, number>();
  const countBySk = new Map<string, number>();
  for (const w of wbs) {
    const pid = (w as { passageId?: string }).passageId;
    const sk = (w as { sourceKey?: string }).sourceKey;
    if (pid) countByPid.set(String(pid), (countByPid.get(String(pid)) ?? 0) + 1);
    else if (sk) countBySk.set(String(sk), (countBySk.get(String(sk)) ?? 0) + 1);
  }

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
  folder?: string;
  data?: EssayStepWorkbookData;
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
  if (!input.data || typeof input.data !== 'object') {
    die('save: input.data (EssayStepWorkbookData) 가 필요합니다.');
  }

  // 1) 검증
  const validation: EssayStepValidationResult = validateEssayStepData(input.data);
  if (!validation.valid && !force) {
    out({
      ok: false,
      reason: 'validation_failed',
      hint: '오류를 고치거나 --force 로 우회하세요.',
      validation,
    });
    process.exit(2);
  }

  // 2) passageId 로 textbook/sourceKey 자동 보강
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

  if (!textbook) die('save: textbook 이 필요합니다 (passageId 없으면 명시 필수).');
  if (!sourceKey) die('save: sourceKey 가 필요합니다 (passageId 없으면 명시 필수).');

  const folder = (input.folder ?? '').trim() || '기본';

  // 3) HTML 생성 (학생용 + 정답키 통합)
  const html = buildEssayStepCombinedHtml({ data: input.data });
  const title = input.data.meta?.topic ?? '서술형집중 워크북';

  // 4) dry-run
  if (dryRun) {
    out({
      ok: true,
      dryRun: true,
      validation,
      textbook,
      sourceKey,
      passageId: passageId || null,
      folder,
      title,
      generated_html_bytes: Buffer.byteLength(html, 'utf8'),
      passage_lines: input.data.passage?.length ?? 0,
      vocab_count: input.data.vocab?.length ?? 0,
      sections_summary: {
        section1_passage: input.data.passage?.length ?? 0,
        section2_vocab: input.data.vocab?.length ?? 0,
        section3_grammar_fix: input.data.grammar_fix?.length ?? 0,
        section3_grammar_box: input.data.grammar_box?.length ?? 0,
        section4_word_arrange: input.data.word_arrange?.length ?? 0,
        section5_blank_one: input.data.blank_one_word?.length ?? 0,
        section6_translation: input.data.translation_sentences?.length ?? 0,
        section7_title_examples: input.data.title_examples?.length ?? 0,
        section8_comprehensive: input.data.comprehensive?.length ?? 0,
      },
    });
    return;
  }

  // 5) 저장
  const id = await saveEssayStepWorkbook({
    title,
    textbook,
    sourceKey,
    passageId: passageId || undefined,
    folder,
    data: input.data,
    html,
  });

  out({
    ok: true,
    id,
    folder,
    sourceKey,
    passageId: passageId || null,
    title,
    validation,
  });
}

// ── 단축 명령 해석 ────────────────────────────────────────────────────────────

function resolveShorthandCommand(cmd: string, tail: string[]): { cmd: string; tail: string[] } {
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'save']);
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
    first.endsWith('cc-essay-step-cli.ts') ||
    first.endsWith('cc-essay-step-cli.js') ||
    path.basename(first) === 'cc-essay-step-cli.ts' ||
    path.basename(first) === 'cc-essay-step-cli.js'
  ) {
    return raw.slice(1);
  }
  return raw;
}

async function main() {
  let [cmd, ...tail] = argvAfterScript();
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npx tsx scripts/cc-essay-step-cli.ts <명령> [옵션]

명령:
  textbooks [--limit N]
  passages --textbook "이름" [--limit N]
  passage  --id <ObjectId>
  shortage --textbook "이름" [--required N] [--folder "..."|all]
  save     --json <파일|->  [--dry-run] [--force]

단축:
  "교재명"  →  shortage --textbook "교재명"

원칙: API 키 호출 없음. Pro 채팅에서 EssayStepWorkbookData JSON 작성 → save 가 검증·HTML 생성·저장.
프롬프트 가이드: scripts/cc-essay-step-prompt.md
`);
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
