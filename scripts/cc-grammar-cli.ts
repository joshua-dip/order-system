/**
 * Claude Code 전용: 「어법공략 워크북」 CLI.
 * Pro 구독으로 채팅에서 4 모드(F·G·H·J) selection JSON 을 작성하고,
 * 이 스크립트로 조회·검증·HTML 생성·저장만 담당하므로 Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI는 .env / .env.local):
 *
 *   npx tsx scripts/cc-grammar-cli.ts textbooks [--limit 200]
 *   npx tsx scripts/cc-grammar-cli.ts passages --textbook "교재명" [--limit 40]
 *   npx tsx scripts/cc-grammar-cli.ts passage --id <ObjectId>
 *   npx tsx scripts/cc-grammar-cli.ts shortage --textbook "교재명"
 *                                            [--modes FGHJ|FG|...]
 *                                            [--folder "..."|all]
 *   npx tsx scripts/cc-grammar-cli.ts coverage [--limit 100]
 *   npx tsx scripts/cc-grammar-cli.ts save --json path/to/draft.json [--dry-run] [--force]
 *   npx tsx scripts/cc-grammar-cli.ts save-all draft1.json draft2.json ... [--dry-run]
 *   cat draft.json | npx tsx scripts/cc-grammar-cli.ts save --json -
 *
 *   단축: 교재명만 → shortage --textbook "교재명" --modes FGHJ
 *   npx tsx scripts/cc-grammar-cli.ts "26년 3월 고1 영어모의고사"
 *
 * save 입력 JSON 스키마 (한 지문, 4 모드 통합):
 *   {
 *     "passageId": "65fa…",                   // 있으면 textbook/sourceKey 자동 보강 + upsert
 *     "textbook":  "26년 3월 고1 영어모의고사",
 *     "sourceKey": "26년 3월 고1 영어모의고사 21번",
 *     "title":     "26년 3월 고1 영어모의고사 21번 어법공략",
 *     "folder":    "기본",
 *     "examMeta": {
 *        "examTitle": "영어 어법공략 평가",
 *        "schoolName": "...", "grade": "2학년",
 *        "questionNumber": "어법공략",
 *        "examSubtitle": "2026 3월 모의고사 · 어법 집중"
 *     },
 *     "sentences": [ {idx, text, tokens, korean?} ... ],
 *     "modes": ["F","G","H","J"],
 *     "modeData": {
 *        "F": { "blocks": [{sentenceIdx, startTokenIdx, endTokenIdx, kind:"word", baseForm}] },
 *        "G": { "points": [{sentenceIdx, startTokenIdx, endTokenIdx, correctForm, wrongForm, explanation}] },
 *        "H": { "spans":  [{sentenceIdx, startTokenIdx, endTokenIdx, isError, wrongForm?, correction?, explanation?}] },
 *        "J": { "items":  [{text, isCorrect, correction?, explanation?}], "intro?": "..." }
 *     }
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildTransformHtml,
  buildEitherOrHtml,
  buildCorrectionHtml,
  buildOxHtml,
  syncPointsToModes,
  type ExamMeta,
} from '@/lib/grammar-workbook-html';
import {
  saveGrammarWorkbook,
  getTextbookCoverage,
  getGrammarShortage,
  type GrammarMode,
  type GrammarModeData,
  GRAMMAR_MODES,
} from '@/lib/grammar-workbooks-store';
import type { SentenceTokenized } from '@/lib/block-workbook-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

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

/** "FGHJ" / "F,G" / "all" → GrammarMode[]. */
function parseModesFlag(raw: string | undefined): GrammarMode[] {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'all') {
    return [...GRAMMAR_MODES];
  }
  const cleaned = raw.toUpperCase().replace(/[\s,]/g, '');
  const out: GrammarMode[] = [];
  for (const ch of cleaned) {
    if ((GRAMMAR_MODES as string[]).includes(ch) && !out.includes(ch as GrammarMode)) {
      out.push(ch as GrammarMode);
    }
  }
  return out.length > 0 ? out : [...GRAMMAR_MODES];
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
  const chapterRaw = (flags.get('chapter') ?? '').trim();
  const chapterArr =
    chapterRaw && chapterRaw !== 'all'
      ? (chapterRaw.includes(',')
          ? chapterRaw.split(',').map(s => s.trim()).filter(Boolean)
          : [chapterRaw])
      : null;
  const db = await getDb('gomijoshua');

  const passageFilter: Record<string, unknown> = { textbook };
  if (chapterArr) passageFilter.chapter = { $in: chapterArr };
  const items = await db
    .collection('passages')
    .find(passageFilter)
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .limit(lim)
    .toArray();

  const passageIds = items.map(p => String(p._id));
  const sourceKeys = items.map(p => (typeof p.source_key === 'string' ? p.source_key : '')).filter(Boolean);

  const wbRows = await db
    .collection('grammar_workbooks')
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
          modes: { $push: '$modes' },
        },
      },
    ])
    .toArray();

  const modesByPid = new Map<string, Set<GrammarMode>>();
  const modesBySk = new Map<string, Set<GrammarMode>>();
  for (const row of wbRows) {
    const k = row._id as { passageId?: string; sourceKey?: string };
    const set = new Set<GrammarMode>();
    for (const arr of row.modes as GrammarMode[][]) {
      if (Array.isArray(arr)) for (const m of arr) set.add(m);
    }
    if (k.passageId) modesByPid.set(String(k.passageId), set);
    else if (k.sourceKey) modesBySk.set(String(k.sourceKey), set);
  }

  out({
    ok: true,
    textbook,
    count: items.length,
    passages: items.map(p => {
      const pid = String(p._id);
      const sk = typeof p.source_key === 'string' ? p.source_key : '';
      const modes = new Set<GrammarMode>([
        ...(modesByPid.get(pid) ?? []),
        ...(modesBySk.get(sk) ?? []),
      ]);
      return {
        passage_id: pid,
        textbook: p.textbook ?? '',
        chapter: p.chapter ?? '',
        number: p.number ?? '',
        source_key: sk,
        modes_done: [...modes].sort(),
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
    notes: [
      'sentences[i].idx === sentenceIdx 로 사용.',
      'F.blocks 의 kind="word", startTokenIdx===endTokenIdx (길이 1).',
      'G.points 와 H.spans 는 startTokenIdx <= endTokenIdx, 같은 문장 내 겹침 금지.',
      'J.items 는 본문과 독립 — 직접 작성한 보기 문장 배열.',
    ],
  });
}

// ── shortage ──────────────────────────────────────────────────────────────────

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const requiredModes = parseModesFlag(flags.get('modes'));
  const folder = (flags.get('folder') ?? 'all').trim();
  const chapter = (flags.get('chapter') ?? '').trim() || undefined;
  const result = await getGrammarShortage({ textbook, requiredModes, folder, chapter });
  out({ ok: true, ...result });
}

// ── coverage ──────────────────────────────────────────────────────────────────

async function cmdCoverage(flags: Map<string, string>) {
  const limit = Math.max(1, Math.floor(flagNum(flags, 'limit', 100)));
  const items = await getTextbookCoverage({ limit });
  out({ ok: true, count: items.length, items });
}

// ── save (단일) ───────────────────────────────────────────────────────────────

interface SaveInput {
  passageId?: string;
  textbook?: string;
  sourceKey?: string;
  title?: string;
  folder?: string;
  examMeta?: ExamMeta;
  sentences?: SentenceTokenized[];
  modes?: GrammarMode[];
  modeData?: GrammarModeData;
}

interface SaveOutput {
  ok: true;
  id: string;
  created: boolean;
  textbook: string;
  sourceKey: string;
  passageId: string | null;
  title: string;
  folder: string;
  modes: GrammarMode[];
  warnings: string[];
}

function validateSaveInput(input: SaveInput): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!input.title?.trim()) warnings.push('title 이 비어 있어 기본값을 사용합니다.');
  if (!input.modes || input.modes.length === 0) errors.push('modes 가 비어 있습니다. ["F","G","H","J"] 중 1개 이상.');
  if (!input.modeData) errors.push('modeData 가 비어 있습니다.');
  const md = input.modeData ?? {};
  const sents = input.sentences ?? [];

  if (input.modes?.includes('F')) {
    if (!md.F || !Array.isArray(md.F.blocks) || md.F.blocks.length === 0) {
      warnings.push('F 가 활성이지만 blocks 가 비어 있습니다.');
    } else {
      const missing = md.F.blocks.filter(b => !(b.baseForm ?? '').trim()).length;
      if (missing > 0) warnings.push(`F: baseForm 미입력 ${missing}개`);
    }
  }
  if (input.modes?.includes('G')) {
    if (!md.G || !Array.isArray(md.G.points) || md.G.points.length === 0) {
      warnings.push('G 가 활성이지만 points 가 비어 있습니다.');
    } else {
      const missing = md.G.points.filter(p => !p.wrongForm?.trim()).length;
      if (missing > 0) warnings.push(`G: wrongForm 미입력 ${missing}개`);
      const noExpl = md.G.points.filter(p => !(p.explanation ?? '').trim()).length;
      if (noExpl > 0) warnings.push(`G: 어법 설명 미입력 ${noExpl}개`);
    }
  }
  if (input.modes?.includes('H')) {
    if (!md.H || !Array.isArray(md.H.spans) || md.H.spans.length === 0) {
      warnings.push('H 가 활성이지만 spans 가 비어 있습니다.');
    } else {
      const errs = md.H.spans.filter(s => s.isError);
      const noWrong = errs.filter(s => !(s.wrongForm ?? '').trim()).length;
      if (noWrong > 0) warnings.push(`H: 오류 구간 중 wrongForm 미입력 ${noWrong}개`);
      const noExpl = errs.filter(s => !(s.explanation ?? '').trim()).length;
      if (noExpl > 0) warnings.push(`H: 오류 구간 어법 설명 미입력 ${noExpl}개`);
    }
  }
  if (input.modes?.includes('J')) {
    if (!md.J || !Array.isArray(md.J.items) || md.J.items.length === 0) {
      warnings.push('J 가 활성이지만 items 가 비어 있습니다.');
    } else {
      const noText = md.J.items.filter(i => !i.text?.trim()).length;
      if (noText > 0) warnings.push(`J: 본문 미입력 항목 ${noText}개`);
      const wrongNoCorr = md.J.items.filter(i => !i.isCorrect && !(i.correction ?? '').trim()).length;
      if (wrongNoCorr > 0) warnings.push(`J: 틀린 보기 ${wrongNoCorr}개에 correction 미입력`);
      const noExpl = md.J.items.filter(i => i.text?.trim() && !(i.explanation ?? '').trim()).length;
      if (noExpl > 0) warnings.push(`J: 어법 설명 미입력 ${noExpl}개`);
    }
  }

  // F/G/H 인덱스 범위 검사
  const checkRanges = (mode: 'F'|'G'|'H', blocks: { sentenceIdx: number; startTokenIdx: number; endTokenIdx: number }[]) => {
    for (const b of blocks) {
      const sent = sents.find(s => s.idx === b.sentenceIdx);
      if (!sent) {
        errors.push(`${mode}: sentenceIdx=${b.sentenceIdx} 가 sentences 에 없습니다.`);
        continue;
      }
      const lastIdx = sent.tokens.length - 1;
      if (b.startTokenIdx < 0 || b.startTokenIdx > lastIdx) errors.push(`${mode}: startTokenIdx=${b.startTokenIdx} 범위 초과 (문장 ${b.sentenceIdx}, 토큰 0..${lastIdx})`);
      if (b.endTokenIdx < b.startTokenIdx || b.endTokenIdx > lastIdx) errors.push(`${mode}: endTokenIdx=${b.endTokenIdx} 가 start..lastIdx 밖`);
    }
  };
  if (input.modes?.includes('F') && md.F) checkRanges('F', md.F.blocks);
  if (input.modes?.includes('G') && md.G) checkRanges('G', md.G.points);
  if (input.modes?.includes('H') && md.H) checkRanges('H', md.H.spans);

  return { warnings, errors };
}

async function _saveOne(input: SaveInput, opts: { dryRun: boolean; force: boolean }): Promise<SaveOutput | { ok: false; reason: string; errors: string[]; warnings: string[] }> {
  let textbook = (input.textbook ?? '').trim();
  let sourceKey = (input.sourceKey ?? '').trim();
  const passageId = (input.passageId ?? '').trim();
  let sentences = input.sentences ?? [];

  if (passageId) {
    if (!ObjectId.isValid(passageId)) die(`save: passageId 가 유효한 ObjectId 가 아닙니다: ${passageId}`);
    const db = await getDb('gomijoshua');
    const p = await db.collection('passages').findOne({ _id: new ObjectId(passageId) });
    if (!p) die(`save: passages 에서 passageId(${passageId}) 를 찾을 수 없습니다.`);
    if (!textbook) textbook = String(p.textbook ?? '');
    if (!sourceKey) sourceKey = String(p.source_key ?? `${p.chapter ?? ''} ${p.number ?? ''}`.trim());
    if (sentences.length === 0) {
      const content = (p as { content?: { original?: string; sentences_en?: unknown; sentences_ko?: unknown } }).content;
      sentences = tokenizePassageFromContent(content ?? null);
    }
  }

  const title = (input.title ?? '').trim() || `${textbook} ${sourceKey} 어법공략`.trim();
  const folder = (input.folder ?? '').trim() || '기본';
  const modes = (input.modes ?? []).filter(m => (GRAMMAR_MODES as string[]).includes(m));
  const modeData = input.modeData ?? {};
  const examMeta = input.examMeta ?? {};

  // ⭐ P.points 가 있으면 F·G·H·J 를 분배 동기화로 자동 생성 (문장당 1개씩 서로 다른 포인트).
  //   웹 페이지 autoSyncOnSave 와 동일 — 포인트 풀이 단일 출처. (이미 채워둔 모드도 덮어씀)
  const poolPts = modeData.P?.points ?? [];
  if (poolPts.length > 0 && sentences.length > 0) {
    const sync = syncPointsToModes(poolPts, sentences);
    modeData.F = { blocks: sync.transformBlocks };
    modeData.G = { points: sync.eitherOrPoints };
    modeData.H = { spans: sync.correctionSpans };
    modeData.J = {
      ...(modeData.J ?? {}),
      items: sync.oxItems.length > 0 ? sync.oxItems : (modeData.J?.items ?? []),
    };
  }

  const v = validateSaveInput({ ...input, textbook, sourceKey, title, modes, modeData, sentences });
  if (v.errors.length > 0 && !opts.force) {
    return { ok: false, reason: 'validation_failed', errors: v.errors, warnings: v.warnings };
  }

  // HTML 빌드
  const html: Partial<Record<GrammarMode, string>> = {};
  const buildOpts = { title, textbook, sourceKey, ...examMeta };
  if (modes.includes('F') && modeData.F) {
    html.F = buildTransformHtml({ ...buildOpts, sentences, blocks: modeData.F.blocks ?? [] });
  }
  if (modes.includes('G') && modeData.G) {
    html.G = buildEitherOrHtml({ ...buildOpts, sentences, points: modeData.G.points ?? [] });
  }
  if (modes.includes('H') && modeData.H) {
    html.H = buildCorrectionHtml({ ...buildOpts, sentences, spans: modeData.H.spans ?? [] });
  }
  if (modes.includes('J') && modeData.J) {
    html.J = buildOxHtml({ ...buildOpts, intro: modeData.J.intro, items: modeData.J.items ?? [] });
  }

  if (opts.dryRun) {
    return {
      ok: true,
      id: '(dry-run)',
      created: false,
      textbook, sourceKey,
      passageId: passageId || null,
      title, folder, modes,
      warnings: v.warnings,
    };
  }

  if (!textbook || !sourceKey) die('save: textbook / sourceKey 가 필요합니다.');

  const result = await saveGrammarWorkbook({
    passageId: passageId || undefined,
    textbook, sourceKey, title, folder,
    examMeta, sentences, modes, modeData, html,
  });

  return {
    ok: true,
    id: result.id,
    created: result.created,
    textbook, sourceKey,
    passageId: passageId || null,
    title, folder, modes,
    warnings: v.warnings,
  };
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
  const result = await _saveOne(parsed as SaveInput, { dryRun, force });
  out(result);
  if (!result.ok) process.exit(2);
}

// ── save-all ─────────────────────────────────────────────────────────────────

async function cmdSaveAll(positional: string[], flags: Map<string, string>) {
  if (positional.length === 0) die('save-all: 1개 이상의 JSON 파일 경로를 지정하세요.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const results: unknown[] = [];
  let okCount = 0;
  let failCount = 0;
  for (const p of positional) {
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    if (!fs.existsSync(abs)) {
      results.push({ file: p, ok: false, reason: 'not_found' });
      failCount += 1;
      continue;
    }
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const parsed = parseJsonInput(raw) as SaveInput;
      const r = await _saveOne(parsed, { dryRun, force });
      results.push({ file: p, ...r });
      if (r.ok) okCount += 1;
      else failCount += 1;
    } catch (e) {
      results.push({ file: p, ok: false, reason: 'exception', message: e instanceof Error ? e.message : String(e) });
      failCount += 1;
    }
  }
  out({ ok: failCount === 0, total: positional.length, ok_count: okCount, fail_count: failCount, results });
  if (failCount > 0) process.exit(2);
}

// ── 단축 명령 해석 ────────────────────────────────────────────────────────────

function resolveShorthandCommand(cmd: string, tail: string[]): { cmd: string; tail: string[] } {
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'coverage', 'save', 'save-all', 'list']);
  if (!known.has(cmd) && !cmd.startsWith('--')) {
    // "교재명::05강" 또는 "교재명::05강,06강" 단축: shortage --textbook X --chapter Y
    const sep = cmd.indexOf('::');
    if (sep > 0) {
      const tb = cmd.slice(0, sep).trim();
      const ch = cmd.slice(sep + 2).trim();
      const extra = ch ? ['--chapter', ch] : [];
      return { cmd: 'shortage', tail: ['--textbook', tb, ...extra, ...tail] };
    }
    return { cmd: 'shortage', tail: ['--textbook', cmd, ...tail] };
  }
  return { cmd, tail };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (
    first.endsWith('cc-grammar-cli.ts') ||
    first.endsWith('cc-grammar-cli.js') ||
    path.basename(first) === 'cc-grammar-cli.ts' ||
    path.basename(first) === 'cc-grammar-cli.js'
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
    console.error(`사용법: npm run cc:grammar -- <명령> [옵션]

명령:
  textbooks [--limit N]
  passages  --textbook "이름" [--limit N] [--chapter "05강"|"05강,06강"|all]
  passage   --id <ObjectId>
  shortage  --textbook "이름" [--modes FGHJ|...] [--folder "..."|all] [--chapter "05강"|"05강,06강"|all]
  coverage  [--limit N]
  save      --json <파일|->  [--dry-run] [--force]
  save-all  draft1.json draft2.json ...  [--dry-run] [--force]

단축:
  "교재명"  →  shortage --textbook "교재명" --modes FGHJ
  "교재명::05강" → shortage --textbook "교재명" --chapter "05강" --modes FGHJ

원칙:
  - API 키 호출 없음. 채팅에서 4 모드(F·G·H·J) 통합 JSON 작성 → save 가 검증·HTML 생성·저장.
  - passageId + 같은 folder 면 upsert (덮어쓰기).
  - 강별 작업: shortage --chapter "05강" 으로 한 강만 부족 지문 조회 → 강 단위 일괄 진행.
`);
    process.exit(cmd ? 0 : 1);
  }

  const resolved = resolveShorthandCommand(cmd, tail);
  cmd = resolved.cmd;
  const { positional, flags } = parseFlags(resolved.tail);

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
    case 'coverage':
      await cmdCoverage(flags);
      break;
    case 'save':
      await cmdSave(flags);
      break;
    case 'save-all':
      await cmdSaveAll(positional, flags);
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
