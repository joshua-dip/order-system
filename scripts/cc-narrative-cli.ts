/**
 * cc:narrative — 서술형 변형(narrative_questions) Pro 전용 생성 CLI.
 * 객관식 변형의 cc:variant 에 대응. API 키 호출 없음 — 채팅에서 question_data 작성 → save 가 검증·insert.
 *
 *   npm run cc:narrative -- textbooks [--limit N]
 *   npm run cc:narrative -- passages --textbook "교재명" [--limit N]
 *   npm run cc:narrative -- passage  --id <passageId>
 *   npm run cc:narrative -- shortage --textbook "교재명" [--required N] [--subtype "이중요지영작형"]
 *   npm run cc:narrative -- save --json <파일|-> [--dry-run] [--force]
 *   npm run cc:narrative -- save-all <f1.json> <f2.json> ...
 *   단축: npm run cc:narrative -- "교재명"   → shortage
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { NARRATIVE_SUBTYPES, validateNarrativeQuestion } from '@/lib/narrative-question-validator';
import { saveNarrativeQuestionToDb, SaveNarrativeInput } from '@/lib/narrative-questions-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

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
    } else positional.push(a);
  }
  return { positional, flags };
}
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));
const die = (m: string): never => { console.error(m); process.exit(1); };
function flagNum(flags: Map<string, string>, key: string, fb: number): number {
  const v = flags.get(key); if (v == null || v === '') return fb;
  const n = Number(v); if (!Number.isFinite(n)) die(`--${key} 는 숫자여야 합니다.`); return n;
}
const flagBool = (flags: Map<string, string>, key: string) => { const v = flags.get(key); return v === 'true' || v === '1'; };
function parseJsonInput(raw: string): unknown {
  let t = raw.trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { return die(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`); }
}

async function cmdTextbooks(flags: Map<string, string>) {
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 200))));
  const db = await getDb('gomijoshua');
  const names = (await db.collection('passages').distinct('textbook')) as unknown[];
  const sorted = names.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim()).sort((a, b) => a.localeCompare(b, 'ko'));
  out({ ok: true, count: Math.min(sorted.length, lim), total_distinct: sorted.length, textbooks: sorted.slice(0, lim) });
}

async function cmdPassages(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('passages: --textbook "교재명" 이 필요합니다.');
  const lim = Math.min(300, Math.max(1, Math.floor(flagNum(flags, 'limit', 40))));
  const db = await getDb('gomijoshua');
  const items = await db.collection('passages').find({ textbook })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 }).limit(lim).toArray();
  const ids = items.map((p) => p._id as ObjectId);
  const rows = await db.collection('narrative_questions').aggregate([
    { $match: { passage_id: { $in: ids } } },
    { $group: { _id: { p: '$passage_id', s: '$narrative_subtype' }, c: { $sum: 1 } } },
  ]).toArray();
  const byPassage = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = r._id as { p: ObjectId; s: string };
    const pid = String(k.p);
    if (!byPassage.has(pid)) byPassage.set(pid, {});
    byPassage.get(pid)![String(k.s)] = Number(r.c);
  }
  out({
    ok: true, textbook, count: items.length,
    passages: items.map((p) => ({
      passage_id: String(p._id), chapter: p.chapter ?? '', number: p.number ?? '',
      source_key: typeof p.source_key === 'string' ? p.source_key : '',
      narrative_counts: byPassage.get(String(p._id)) ?? {},
    })),
  });
}

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id || !ObjectId.isValid(id)) die('passage: --id <passageId> (유효한 ObjectId) 가 필요합니다.');
  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!p) die(`passage_id ${id} 없음`);
  const content = (p!.content ?? {}) as Record<string, unknown>;
  const existing = await db.collection('narrative_questions')
    .find({ passage_id: new ObjectId(id) })
    .project({ narrative_subtype: 1, number: 1, source_file: 1 }).toArray();
  out({
    ok: true, passage_id: id, textbook: p!.textbook ?? '', source_key: p!.source_key ?? '',
    chapter: p!.chapter ?? '', number: p!.number ?? '',
    content: {
      original: String(content.original ?? ''),
      translation: String(content.translation ?? ''),
      sentences_en: content.sentences_en ?? [],
      sentences_ko: content.sentences_ko ?? [],
    },
    existing_narrative: existing.map((e) => ({ id: String(e._id), subtype: e.narrative_subtype, number: e.number, source: e.source_file })),
    supported_subtypes: NARRATIVE_SUBTYPES,
  });
}

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.floor(flagNum(flags, 'required', 1)));
  const onlySub = (flags.get('subtype') ?? '').trim();
  const subs = onlySub ? [onlySub] : [...NARRATIVE_SUBTYPES];
  const db = await getDb('gomijoshua');
  const passages = await db.collection('passages').find({ textbook })
    .project({ _id: 1, source_key: 1, number: 1 }).toArray();
  const ids = passages.map((p) => p._id as ObjectId);
  const rows = await db.collection('narrative_questions').aggregate([
    { $match: { passage_id: { $in: ids } } },
    { $group: { _id: { p: '$passage_id', s: '$narrative_subtype' }, c: { $sum: 1 } } },
  ]).toArray();
  const cnt = new Map<string, number>();
  for (const r of rows) { const k = r._id as { p: ObjectId; s: string }; cnt.set(`${String(k.p)}|${k.s}`, Number(r.c)); }
  const underfilled: Array<Record<string, unknown>> = [];
  let need = 0;
  for (const p of passages) {
    for (const s of subs) {
      const have = cnt.get(`${String(p._id)}|${s}`) ?? 0;
      if (have < required) {
        need += required - have;
        underfilled.push({ passage_id: String(p._id), source_key: p.source_key ?? '', subtype: s, have, required, shortBy: required - have });
      }
    }
  }
  out({
    ok: true, textbook, required, subtypes: subs,
    matchedPassages: passages.length,
    needCreateGrandTotal: need,
    underfilledTotal: underfilled.length,
    underfilled: underfilled.slice(0, 200),
    note: 'needCreateGrandTotal = 각 (지문×subtype) 가 required 에 못 미치는 부족분 합. variant_get_passage 대응: cc:narrative passage --id 로 원문 받아 채팅 작성 → save.',
  });
}

function toSaveInput(o: Record<string, unknown>): SaveNarrativeInput {
  return {
    passage_id: String(o.passage_id ?? ''),
    textbook: o.textbook ? String(o.textbook) : undefined,
    narrative_subtype: String(o.narrative_subtype ?? (o.question_data as Record<string, unknown>)?.['문제유형'] ?? ''),
    chapter: o.chapter ? String(o.chapter) : undefined,
    number: o.number ? String(o.number) : undefined,
    question_data: (o.question_data ?? {}) as Record<string, unknown>,
    status: o.status ? String(o.status) : undefined,
  };
}

async function cmdSave(flags: Map<string, string>) {
  const jsonArg = (flags.get('json') ?? '').trim();
  if (!jsonArg) die('save: --json <파일|-> 가 필요합니다.');
  const raw = jsonArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(jsonArg, 'utf8');
  const parsed = parseJsonInput(raw) as Record<string, unknown>;
  const input = toSaveInput(parsed);
  const dryRun = flagBool(flags, 'dry-run');

  if (dryRun) {
    const v = validateNarrativeQuestion(input.narrative_subtype, input.question_data);
    out({ ok: v.ok, dry_run: true, narrative_subtype: input.narrative_subtype, errors: v.errors, warnings: v.warnings });
    return;
  }
  const res = await saveNarrativeQuestionToDb(input);
  out(res);
  if (!res.ok) process.exit(2);
}

async function cmdSaveAll(flags: Map<string, string>, positional: string[]) {
  const files = positional.length ? positional : (flags.get('json') ? [flags.get('json')!] : []);
  if (!files.length) die('save-all: 파일 경로(positional) 또는 --json 이 필요합니다.');
  const dryRun = flagBool(flags, 'dry-run');
  const results: unknown[] = [];
  for (const f of files) {
    const parsed = parseJsonInput(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
    const input = toSaveInput(parsed);
    if (dryRun) {
      const v = validateNarrativeQuestion(input.narrative_subtype, input.question_data);
      results.push({ file: f, ok: v.ok, dry_run: true, errors: v.errors, warnings: v.warnings });
    } else {
      results.push({ file: f, ...(await saveNarrativeQuestionToDb(input)) });
    }
  }
  out({ ok: results.every((r) => (r as { ok?: boolean }).ok !== false), count: results.length, results });
}

function help() {
  console.log(`cc:narrative — 서술형 변형(narrative_questions) Pro 전용 생성 CLI (API 호출 없음)

명령:
  textbooks [--limit N]
  passages --textbook "교재명" [--limit N]      — 지문별 subtype 보유 수
  passage  --id <passageId>                      — 원문 + 기존 서술형 + 지원 subtype
  shortage --textbook "교재명" [--required N] [--subtype "..."]
  save     --json <파일|->  [--dry-run]          — 검증 후 narrative_questions insert
  save-all <f1.json> <f2.json> ... [--dry-run]
  단축: "교재명"  →  shortage

지원 subtype: ${NARRATIVE_SUBTYPES.join(' / ')}

save JSON: { passage_id, narrative_subtype, question_data{번호,강,문제유형,점수,문제,본문,완전한문제,모범답안,해설, (빈칸재배열형: 원문·키워드·키워드개수·답안단어수) (주제완성형: 주제틀·주어진표현·최소단어수·답안단어수·조건) (요약문빈칸완성형: 요약문·빈칸들[{기호,단어수,답}]·조건)}, [textbook,chapter,number,status] }
저장 마커: source_file='claude-code', excel_row_status='claude-authored' (엑셀 임포트분과 구분).
원칙: API 키 호출 없음. 채팅에서 question_data 작성 → save 가 검증·insert.`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { help(); process.exit(0); }
  let cmd = argv[0];
  let tail = argv.slice(1);
  // 단축: 첫 인자가 명령이 아니면 교재명으로 보고 shortage
  const KNOWN = new Set(['textbooks', 'passages', 'passage', 'shortage', 'save', 'save-all']);
  if (!KNOWN.has(cmd)) { tail = ['--textbook', cmd, ...tail]; cmd = 'shortage'; }
  const { flags, positional } = parseFlags(tail);
  switch (cmd) {
    case 'textbooks': await cmdTextbooks(flags); break;
    case 'passages': await cmdPassages(flags); break;
    case 'passage': await cmdPassage(flags); break;
    case 'shortage': await cmdShortage(flags); break;
    case 'save': await cmdSave(flags); break;
    case 'save-all': await cmdSaveAll(flags, positional); break;
    default: help();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
