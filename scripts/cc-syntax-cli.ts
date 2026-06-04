/**
 * Pro 전용 지문분석기 CLI (cc:syntax).
 *
 * 채팅에서 만든 분석 JSON 을 검증·저장만 한다. ANTHROPIC API 키 호출 없음.
 *
 *   npx tsx scripts/cc-syntax-cli.ts textbooks
 *   npx tsx scripts/cc-syntax-cli.ts passages --textbook "..."
 *   npx tsx scripts/cc-syntax-cli.ts passage  --id <passageId>
 *   npx tsx scripts/cc-syntax-cli.ts shortage --textbook "..." [--required 100]
 *   npx tsx scripts/cc-syntax-cli.ts next-empty --textbook "..." [--required 100]
 *   npx tsx scripts/cc-syntax-cli.ts save --json <file> [--dry-run] [--passage-id <pid>]
 *   npx tsx scripts/cc-syntax-cli.ts save-all <file1> <file2> ... [--dry-run]
 *   npx tsx scripts/cc-syntax-cli.ts export <passageId>
 *
 * 단축:  npm run cc:syntax -- "<교재명>"   → shortage --textbook "..."
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  passageAnalysisFileNameForPassageId,
  type PassageStateStored,
} from '@/lib/passage-analyzer-types';
import { passageAnalyzerProgressFromMain } from '@/lib/passage-analyzer-progress-score';
import { validateSyntaxAnalyzerJson } from '@/lib/syntax-analyzer-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const COL = 'passage_analyses';

function out(obj: unknown) { console.log(JSON.stringify(obj, null, 2)); }
function die(msg: string): never { console.error(msg); process.exit(1); }

/* ─── 인자 파서 ──────────────────────────────────────────────────────────── */

function parseFlags(argv: string[]): { flags: Map<string, string>; positional: string[]; boolFlags: Set<string> } {
  const flags = new Map<string, string>();
  const boolFlags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        boolFlags.add(key);
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional, boolFlags };
}

function flagNum(flags: Map<string, string>, key: string, def: number): number {
  const v = flags.get(key);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/* ─── DB 헬퍼 ────────────────────────────────────────────────────────────── */

async function loadMain(passageId: string): Promise<{ fileName: string; main: PassageStateStored | null }> {
  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const db = await getDb('gomijoshua');
  const doc = await db.collection(COL).findOne<{ passageStates?: { main?: PassageStateStored } }>({ fileName });
  return { fileName, main: doc?.passageStates?.main ?? null };
}

async function saveMainToMongo(fileName: string, main: PassageStateStored, editorNote: string) {
  const db = await getDb('gomijoshua');
  const col = db.collection(COL);
  const now = new Date();
  const cur = await col.findOne({ fileName });
  const newVersion = Math.floor(Number((cur as { version?: number })?.version) || 0) + 1;
  await col.updateOne(
    { fileName },
    {
      $set: {
        fileName,
        teacherId: null,
        collaborationHostId: null,
        passageStates: { main },
        version: newVersion,
        lastEditorId: 'cli',
        lastEditorName: editorNote,
        lastSaved: now.toISOString(),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return newVersion;
}

/** 영어 본문 → 문장 배열 (cc:essay-cli 의 parseSentences 와 동일 규칙) */
function parseSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

/* ─── textbooks / passages / passage ──────────────────────────────────── */

async function cmdTextbooks(flags: Map<string, string>) {
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 200))));
  const db = await getDb('gomijoshua');
  const names = await db.collection('passages').distinct('textbook');
  const sorted = (names as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim())
    .sort((a, b) => a.localeCompare(b, 'ko'));
  out({ ok: true, count: Math.min(lim, sorted.length), total_distinct: sorted.length, textbooks: sorted.slice(0, lim) });
}

async function cmdPassages(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('passages: --textbook "교재명" 이 필요합니다.');
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 100))));
  const db = await getDb('gomijoshua');

  const items = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .limit(lim)
    .toArray();

  /* 분석 상태 한 번에 받기 */
  const fileNames = items.map(p => passageAnalysisFileNameForPassageId(String(p._id)));
  const analysesArr = await db
    .collection(COL)
    .find({ fileName: { $in: fileNames } })
    .project({ fileName: 1, 'passageStates.main': 1, version: 1, lastSaved: 1 })
    .toArray();
  const analysisByFile = new Map<string, PassageStateStored | null>();
  for (const a of analysesArr as Array<{ fileName: string; passageStates?: { main?: PassageStateStored } }>) {
    analysisByFile.set(a.fileName, a.passageStates?.main ?? null);
  }

  out({
    ok: true,
    textbook,
    count: items.length,
    passages: items.map(p => {
      const pid = String(p._id);
      const fn = passageAnalysisFileNameForPassageId(pid);
      const main = analysisByFile.get(fn) ?? null;
      const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown> | null);
      return {
        passage_id: pid,
        textbook: p.textbook ?? '',
        chapter: p.chapter ?? '',
        number: p.number ?? '',
        source_key: typeof p.source_key === 'string' ? p.source_key : '',
        analysis_done: prog.done,
        analysis_total: prog.total,
        analysis_percent: prog.percent,
      };
    }),
  });
}

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id || !ObjectId.isValid(id)) die('passage: --id <ObjectId> 가 필요합니다.');

  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!p) die('passage 를 찾을 수 없습니다.');

  const pAsRec = p as unknown as Record<string, unknown>;
  const content = (p.content ?? {}) as Record<string, unknown>;
  const original =
    (typeof content.original === 'string' && content.original) ||
    (typeof pAsRec.original === 'string' ? (pAsRec.original as string) : '') ||
    '';
  const translation =
    (typeof content.translation === 'string' && content.translation) ||
    (typeof pAsRec.translation === 'string' ? (pAsRec.translation as string) : '') ||
    '';
  const sentencesEn = Array.isArray((content as { sentences?: unknown }).sentences)
    ? ((content as { sentences: unknown[] }).sentences.filter((s): s is string => typeof s === 'string'))
    : parseSentences(original);
  const sentencesKo = Array.isArray((content as { sentences_ko?: unknown }).sentences_ko)
    ? ((content as { sentences_ko: unknown[] }).sentences_ko.filter((s): s is string => typeof s === 'string'))
    : parseSentences(translation);

  const { fileName, main } = await loadMain(id);
  const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown> | null);

  out({
    ok: true,
    passage_id: id,
    file_name: fileName,
    textbook: p.textbook ?? '',
    source_key: typeof p.source_key === 'string' ? p.source_key : '',
    chapter: p.chapter ?? '',
    number: p.number ?? '',
    original,
    translation,
    sentences_count: sentencesEn.length,
    sentences: sentencesEn.map((s, i) => ({ idx: i, en: s, ko: sentencesKo[i] ?? '' })),
    has_existing_analysis: main !== null,
    current_progress: prog,
    /* main 의 현재 채워진 키만 요약 — 다 받고 싶으면 export 사용 */
    filled_keys: main ? Object.keys(main).filter(k => {
      const v = (main as unknown as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length > 0;
      if (v && typeof v === 'object') return Object.keys(v).length > 0;
      return v !== undefined && v !== null && v !== '';
    }) : [],
  });
}

/* ─── shortage / next-empty ──────────────────────────────────────────── */

async function findShortPassageRows(textbook: string, required: number) {
  const db = await getDb('gomijoshua');
  const items = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, source_key: 1 })
    .sort({ chapter: 1, number: 1 })
    .toArray();

  const rows: Array<{ passage_id: string; source_key: string; percent: number; done: number; total: number }> = [];
  for (const p of items) {
    const pid = String(p._id);
    const fn = passageAnalysisFileNameForPassageId(pid);
    const doc = await db.collection(COL).findOne<{ passageStates?: { main?: PassageStateStored } }>({ fileName: fn });
    const main = doc?.passageStates?.main ?? null;
    const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown> | null);
    if (prog.percent < required) {
      rows.push({
        passage_id: pid,
        source_key: typeof p.source_key === 'string' ? p.source_key : '',
        percent: prog.percent,
        done: prog.done,
        total: prog.total,
      });
    }
  }
  return { textbook, required, total_passages: items.length, short: rows };
}

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.min(100, Math.floor(flagNum(flags, 'required', 100))));
  const res = await findShortPassageRows(textbook, required);
  out({ ok: true, ...res, short_count: res.short.length });
}

async function cmdNextEmpty(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('next-empty: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.min(100, Math.floor(flagNum(flags, 'required', 100))));
  const res = await findShortPassageRows(textbook, required);
  if (res.short.length === 0) {
    out({ ok: true, done: true, message: `「${textbook}」 모든 지문 분석이 ${required}% 이상입니다.` });
    return;
  }
  /* 가장 비어 있는 (percent 작은) 지문 우선 */
  const next = [...res.short].sort((a, b) => a.percent - b.percent)[0];
  out({ ok: true, done: false, next, remaining: res.short.length, textbook, required });
}

/* ─── save / save-all / export ───────────────────────────────────────── */

interface SaveInput {
  passageId?: string;
  main?: PassageStateStored;
  /* JSON 이 PassageStateStored 본문만 담아도 OK */
  sentences?: unknown;
  koreanSentences?: unknown;
}

function readJsonInput(filePath: string): unknown {
  let raw: string;
  if (filePath === '-' || filePath === '/dev/stdin') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    raw = fs.readFileSync(filePath, 'utf8');
  }
  /* 코드펜스 ```json ... ``` 자동 제거 */
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  return JSON.parse(body.trim());
}

function resolvePassageIdAndMain(parsed: unknown, overridePid?: string): { passageId: string; main: PassageStateStored } {
  if (!parsed || typeof parsed !== 'object') die('JSON 최상위가 객체가 아닙니다.');
  const o = parsed as SaveInput & Record<string, unknown>;
  const pid = (overridePid ?? o.passageId ?? '').toString().trim();
  if (!pid) die('passageId 를 알 수 없습니다. JSON 안 passageId 또는 --passage-id 플래그가 필요합니다.');
  if (!ObjectId.isValid(pid)) die(`passageId "${pid}" 가 유효한 ObjectId 가 아닙니다.`);

  let main: PassageStateStored;
  if (o.main && typeof o.main === 'object') {
    main = o.main as PassageStateStored;
  } else if (Array.isArray(o.sentences)) {
    /* raw 본문 (top-level 에 sentences 가 있는 형태) */
    main = parsed as PassageStateStored;
  } else {
    die('JSON 에 main(={...}) 또는 본문(sentences/koreanSentences 등) 이 필요합니다.');
  }
  return { passageId: pid, main };
}

async function cmdSave(flags: Map<string, string>, boolFlags: Set<string>) {
  const file = flags.get('json');
  if (!file) die('save: --json <경로> 또는 --json - (stdin) 이 필요합니다.');
  const overridePid = flags.get('passage-id');
  const dryRun = boolFlags.has('dry-run');

  const parsed = readJsonInput(file);
  const { passageId, main } = resolvePassageIdAndMain(parsed, overridePid);

  const v = validateSyntaxAnalyzerJson({ main });
  if (!v.ok) {
    out({ ok: false, passageId, validation: v });
    process.exit(2);
  }

  if (dryRun) {
    const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown>);
    out({ ok: true, dry_run: true, passageId, validation: v, projected_progress: prog });
    return;
  }

  const fileName = passageAnalysisFileNameForPassageId(passageId);
  const version = await saveMainToMongo(fileName, main, 'cli-syntax');
  const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown>);
  out({ ok: true, passageId, fileName, version, progress: prog, validation: v });
}

async function cmdSaveAll(flags: Map<string, string>, positional: string[], boolFlags: Set<string>) {
  const files = positional;
  if (files.length === 0) die('save-all: JSON 파일 경로를 1 개 이상 인자로 전달하세요.');
  const dryRun = boolFlags.has('dry-run');
  const results: unknown[] = [];
  let allOk = true;
  for (const f of files) {
    try {
      const parsed = readJsonInput(f);
      const { passageId, main } = resolvePassageIdAndMain(parsed);
      const v = validateSyntaxAnalyzerJson({ main });
      if (!v.ok) {
        allOk = false;
        results.push({ file: f, ok: false, passageId, validation: v });
        continue;
      }
      if (dryRun) {
        const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown>);
        results.push({ file: f, ok: true, dry_run: true, passageId, validation: v, projected_progress: prog });
      } else {
        const fileName = passageAnalysisFileNameForPassageId(passageId);
        const version = await saveMainToMongo(fileName, main, 'cli-syntax-saveall');
        const prog = passageAnalyzerProgressFromMain(main as unknown as Record<string, unknown>);
        results.push({ file: f, ok: true, passageId, fileName, version, progress: prog });
      }
    } catch (e) {
      allOk = false;
      results.push({ file: f, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  out({ ok: allOk, count: results.length, results });
  if (!allOk) process.exit(2);
}

async function cmdExport(positional: string[]) {
  const id = positional[0];
  if (!id) die('export <passageId> 가 필요합니다.');
  if (!ObjectId.isValid(id)) die(`passageId "${id}" 가 유효한 ObjectId 가 아닙니다.`);
  const { fileName, main } = await loadMain(id);
  if (!main) die(`passageStates.main 이 없습니다: passage:${id}`);
  out({ ok: true, fileName, passageId: id, main });
}

/* ─── main ────────────────────────────────────────────────────────────── */

function helpText() {
  return `cc:syntax — Pro 전용 지문분석기 CLI (API 키 호출 없음)

  npm run cc:syntax -- textbooks
  npm run cc:syntax -- passages --textbook "교재명" [--limit 100]
  npm run cc:syntax -- passage  --id <passageId>
  npm run cc:syntax -- shortage --textbook "교재명" [--required 100]
  npm run cc:syntax -- next-empty --textbook "교재명" [--required 100]
  npm run cc:syntax -- save --json <file> [--passage-id <pid>] [--dry-run]
  npm run cc:syntax -- save-all <file1> <file2> ... [--dry-run]
  npm run cc:syntax -- export <passageId>

  단축: npm run cc:syntax -- "교재명"  →  shortage --textbook "교재명"

작성 흐름:
  1) passage --id <pid> 로 지문·문장표 + 현재 분석 상태 받기
  2) 채팅에서 PassageStateStored JSON 작성 ({ passageId, main: { ... } })
  3) save --json <file> --dry-run 으로 검증
  4) save --json <file> 로 저장 (passage_analyses.passageStates.main 갱신)
`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(helpText());
    return;
  }

  /* 단축: 첫 인자가 알려진 명령이 아니고 플래그도 아니면 → shortage --textbook <인자> */
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'next-empty', 'save', 'save-all', 'export']);
  let cmd: string;
  let tail: string[];
  if (!argv[0].startsWith('--') && !known.has(argv[0])) {
    cmd = 'shortage';
    tail = ['--textbook', argv[0], ...argv.slice(1)];
  } else {
    cmd = argv[0];
    tail = argv.slice(1);
  }

  const { flags, positional, boolFlags } = parseFlags(tail);

  switch (cmd) {
    case 'textbooks':   await cmdTextbooks(flags); break;
    case 'passages':    await cmdPassages(flags); break;
    case 'passage':     await cmdPassage(flags); break;
    case 'shortage':    await cmdShortage(flags); break;
    case 'next-empty':  await cmdNextEmpty(flags); break;
    case 'save':        await cmdSave(flags, boolFlags); break;
    case 'save-all':    await cmdSaveAll(flags, positional, boolFlags); break;
    case 'export':      await cmdExport(positional); break;
    default:            die(`알 수 없는 명령: ${cmd}\n\n${helpText()}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
