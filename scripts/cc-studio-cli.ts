/**
 * Pro 전용 출제 스튜디오 CLI (cc:studio).
 *
 * /my/vip/studio 의 '출제 포인트(marks)' 를 채팅에서 같이 잡아 저장만 한다. ANTHROPIC API 키 호출 없음.
 * (스튜디오 = vip_studio 컬렉션, (userId,passageId) 1문서. 객관식 변형 DB와 별개.)
 *
 *   npx tsx scripts/cc-studio-cli.ts exams     --user <email|loginId|이름> [--school "..."] [--grade 1]
 *   npx tsx scripts/cc-studio-cli.ts exam      --id <examId>                       # 시험범위 지문 + passageId 목록
 *   npx tsx scripts/cc-studio-cli.ts find      --textbook "..." [--source "..."]   # 모의고사 지문 passageId 찾기
 *   npx tsx scripts/cc-studio-cli.ts passage   --id <passageId> [--user <...>]     # 원문 + 문장표 + 현재 마크/유형 카운트
 *   npx tsx scripts/cc-studio-cli.ts export    <passageId> --user <...>            # 현재 marks 를 save-marks JSON 형태로 덤프
 *   npx tsx scripts/cc-studio-cli.ts save-marks --json <file> [--dry-run] [--passage-id <pid>] [--user <...>] [--mode merge|replace]
 *   cat draft.json | npx tsx scripts/cc-studio-cli.ts save-marks --json -          # stdin (코드펜스 ```json 자동 제거)
 *
 * 단축:  npm run cc:studio -- <passageId>            → passage --id <passageId>
 *
 * save-marks JSON 스키마:
 *   { "passageId": "<id>", "user": "<email|loginId>", "mode": "merge"|"replace",
 *     "marks": [ { "scope":"word"|"phrase"|"sentence", "target":"원문 표현", "qTypes":["어법","빈칸"],
 *                  "note":"메모", "occurrence":1 } ] }
 *   - 위치(start/end)는 CLI 가 target 의 occurrence(기본 1)번째 등장을 원문에서 찾아 자동 고정.
 *   - mode merge(기본): 같은 위치만 건너뛰고 추가 / replace: 기존 marks 전부 교체. (problems 는 절대 안 건드림)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  VIP_STUDIO_COLLECTION,
  ensureStudioIndexes,
  normalizeStudioMarks,
  STUDIO_QTYPES,
  STUDIO_MARK_SCOPES,
  type StudioMark,
  type VipStudioDoc,
} from '@/lib/vip-studio-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const GRAMMAR_TARGET = 5; // 어법 문제는 밑줄 ①~⑤ = 5개 이상 필요

function out(obj: unknown) { console.log(JSON.stringify(obj, null, 2)); }
function die(msg: string): never { console.error(msg); process.exit(1); }
function collapse(s: unknown): string { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

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
      if (next !== undefined && !next.startsWith('--')) { flags.set(key, next); i++; }
      else boolFlags.add(key);
    } else positional.push(a);
  }
  return { flags, positional, boolFlags };
}

/* ─── 공통 조회 ──────────────────────────────────────────────────────────── */
async function resolveUser(who: string | undefined): Promise<{ userId: ObjectId; name: string; loginId: string }> {
  if (!who) die('--user <email|loginId|이름> 가 필요합니다.');
  const db = await getDb('gomijoshua');
  const u = await db.collection('users').findOne(
    { $or: [{ email: who }, { loginId: who }, { name: who }] },
    { projection: { name: 1, loginId: 1, email: 1 } },
  );
  if (!u) die(`사용자를 찾지 못했습니다: ${who}`);
  return { userId: u._id as ObjectId, name: String(u.name ?? ''), loginId: String(u.loginId ?? '') };
}

interface PassageInfo { passageId: string; textbook: string; sourceKey: string; original: string; sentences: string[] }
async function loadPassage(passageId: string): Promise<PassageInfo> {
  if (!ObjectId.isValid(passageId)) die(`passageId 형식 오류: ${passageId}`);
  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne(
    { _id: new ObjectId(passageId) },
    { projection: { textbook: 1, source_key: 1, 'content.original': 1 } },
  );
  if (!p) die(`지문을 찾지 못했습니다: ${passageId}`);
  const original = collapse((p.content as { original?: unknown } | undefined)?.original);
  if (!original) die(`이 지문의 원문(content.original)이 비어 있습니다: ${passageId}`);
  return {
    passageId,
    textbook: String(p.textbook ?? ''),
    sourceKey: String(p.source_key ?? ''),
    original,
    sentences: splitSentences(original),
  };
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).map((s) => s.trim()).filter(Boolean);
}

/** target 의 occurrence(1-based)번째 등장 위치 [start,end). 단어/구 양끝이 단어문자면 \b 로 중간 매칭 방지. */
function findOccurrence(original: string, target: string, occurrence: number): { start: number; end: number } | null {
  const t = target.trim(); if (!t) return null;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bs = /^\w/.test(t) ? '\\b' : '';
  const be = /\w$/.test(t) ? '\\b' : '';
  const re = new RegExp(`${bs}${esc}${be}`, 'gi');
  let m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(original)) !== null) {
    n++;
    if (n === occurrence) return { start: m.index, end: m.index + m[0].length };
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return null;
}

function countByType(marks: StudioMark[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const m of marks) for (const t of m.qTypes) c[t] = (c[t] ?? 0) + 1;
  return c;
}
function grammarStatus(marks: StudioMark[]): string {
  const g = marks.filter((m) => m.qTypes.includes('어법')).length;
  return `어법 ${g}/${GRAMMAR_TARGET}${g >= GRAMMAR_TARGET ? ' ✓ 출제가능' : ` (${GRAMMAR_TARGET - g}개 더 필요)`}`;
}

/* ─── 명령들 ────────────────────────────────────────────────────────────── */
async function cmdExams(flags: Map<string, string>) {
  const user = await resolveUser(flags.get('user'));
  const db = await getDb('gomijoshua');
  const q: Record<string, unknown> = { userId: user.userId };
  if (flags.get('grade')) q.grade = Number(flags.get('grade'));
  const exams = await db.collection('vip_school_exams')
    .find(q, { projection: { examType: 1, academicYear: 1, grade: 1, schoolId: 1, examScopePassages: 1 } })
    .sort({ academicYear: -1, grade: 1 }).limit(80).toArray();
  // 학교 이름 보강
  const schoolIds = [...new Set(exams.map((e) => (e.schoolId ? String(e.schoolId) : '')).filter(Boolean))];
  const schoolName = new Map<string, string>();
  for (const sid of schoolIds) {
    if (!ObjectId.isValid(sid)) continue;
    const s = await db.collection('vip_schools').findOne({ _id: new ObjectId(sid) }, { projection: { schoolName: 1, name: 1 } });
    if (s) schoolName.set(sid, String(s.schoolName ?? s.name ?? ''));
  }
  const filterSchool = flags.get('school');
  const rows = exams.map((e) => ({
    examId: String(e._id),
    school: schoolName.get(String(e.schoolId ?? '')) ?? '',
    academicYear: Number(e.academicYear ?? 0),
    grade: Number(e.grade ?? 0),
    examType: String(e.examType ?? ''),
    scopeCount: Array.isArray(e.examScopePassages) ? e.examScopePassages.length : 0,
  })).filter((r) => !filterSchool || r.school.includes(filterSchool));
  out({ user: user.name || user.loginId, count: rows.length, exams: rows });
}

async function cmdExam(flags: Map<string, string>) {
  const id = flags.get('id'); if (!id || !ObjectId.isValid(id)) die('--id <examId> 가 필요합니다.');
  const db = await getDb('gomijoshua');
  const exam = await db.collection('vip_school_exams').findOne(
    { _id: new ObjectId(id) },
    { projection: { examScopePassages: 1, examType: 1, academicYear: 1, grade: 1 } },
  );
  if (!exam) die(`시험을 찾지 못했습니다: ${id}`);
  const keys: string[] = Array.isArray(exam.examScopePassages) ? exam.examScopePassages.map(String) : [];
  const pairs = keys.map((k) => { const i = k.indexOf('::'); return i < 0 ? { key: k, textbook: '', sourceKey: k } : { key: k, textbook: k.slice(0, i), sourceKey: k.slice(i + 2) }; }).filter((p) => p.sourceKey);
  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const docs = or.length ? await db.collection('passages').find({ $or: or }, { projection: { textbook: 1, source_key: 1, 'content.original': 1 } }).toArray() : [];
  const lookup = new Map<string, { passageId: string; original: string }>();
  for (const d of docs) {
    const en = collapse((d.content as { original?: unknown })?.original);
    lookup.set(`${String(d.textbook ?? '')}::${String(d.source_key ?? '')}`, { passageId: String(d._id), original: en });
    if (!lookup.has(`::${String(d.source_key ?? '')}`)) lookup.set(`::${String(d.source_key ?? '')}`, { passageId: String(d._id), original: en });
  }
  const passages = pairs
    .slice().sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'ko', { numeric: true }))
    .map((p) => {
      const hit = lookup.get(`${p.textbook}::${p.sourceKey}`) ?? lookup.get(`::${p.sourceKey}`);
      return { sourceKey: p.sourceKey, textbook: p.textbook, passageId: hit?.passageId ?? '', preview: (hit?.original ?? '').slice(0, 70) };
    });
  out({ examId: id, examType: String(exam.examType ?? ''), academicYear: Number(exam.academicYear ?? 0), grade: Number(exam.grade ?? 0), scopeCount: passages.length, passages });
}

async function cmdFind(flags: Map<string, string>) {
  const textbook = flags.get('textbook'); if (!textbook) die('--textbook "<교재명>" 이 필요합니다.');
  const source = flags.get('source');
  const db = await getDb('gomijoshua');
  const q: Record<string, unknown> = { textbook };
  if (source) q.source_key = source;
  const docs = await db.collection('passages').find(q, { projection: { source_key: 1, 'content.original': 1 } })
    .sort({ source_key: 1 }).limit(200).toArray();
  const rows = docs.map((d) => ({ passageId: String(d._id), sourceKey: String(d.source_key ?? ''), preview: collapse((d.content as { original?: unknown })?.original).slice(0, 70) }));
  out({ textbook, count: rows.length, passages: rows });
}

async function cmdPassage(flags: Map<string, string>) {
  const id = flags.get('id'); if (!id) die('--id <passageId> 가 필요합니다.');
  const passage = await loadPassage(id);
  const db = await getDb('gomijoshua');
  // 이 지문을 마킹한 사용자 목록(누구 걸 볼지 --user 정할 때 참고)
  const allDocs = await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION)
    .find({ passageId: id }, { projection: { userName: 1, loginId: 1, marks: 1, problems: 1 } }).toArray();
  const owners = allDocs.map((d) => ({ userName: d.userName ?? '', loginId: d.loginId ?? '', markCount: Array.isArray(d.marks) ? d.marks.length : 0, problemCount: Array.isArray(d.problems) ? d.problems.length : 0 }));

  let marks: StudioMark[] = [];
  let userLabel = '';
  if (flags.get('user')) {
    const user = await resolveUser(flags.get('user'));
    userLabel = user.name || user.loginId;
    const doc = await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).findOne({ userId: user.userId, passageId: id });
    marks = normalizeStudioMarks(doc?.marks);
  }
  out({
    passageId: passage.passageId,
    textbook: passage.textbook,
    sourceKey: passage.sourceKey,
    user: userLabel || '(미지정 — 특정 사용자 마크는 --user)',
    owners,
    sentenceCount: passage.sentences.length,
    sentences: passage.sentences.map((s, i) => ({ n: i + 1, text: s })),
    original: passage.original,
    currentMarks: marks.map((m) => ({ scope: m.scope, target: m.target, qTypes: m.qTypes, note: m.note, start: m.start })),
    typeCounts: countByType(marks),
    grammarStatus: grammarStatus(marks),
  });
}

async function cmdExport(positional: string[], flags: Map<string, string>) {
  const id = positional[0] || flags.get('id'); if (!id) die('export <passageId> --user <...> 형식입니다.');
  const passage = await loadPassage(id);
  const user = await resolveUser(flags.get('user'));
  const db = await getDb('gomijoshua');
  const doc = await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).findOne({ userId: user.userId, passageId: id });
  const marks = normalizeStudioMarks(doc?.marks);
  out({
    passageId: id,
    user: user.loginId || user.name,
    mode: 'merge',
    marks: marks.map((m) => ({ scope: m.scope, target: m.target, qTypes: m.qTypes, note: m.note, start: m.start })),
    _meta: { textbook: passage.textbook, sourceKey: passage.sourceKey, grammarStatus: grammarStatus(marks) },
  });
}

/* ─── save-marks ─────────────────────────────────────────────────────────── */
function readJsonInput(spec: string | undefined): Record<string, unknown> {
  if (!spec) die('--json <file|-> 가 필요합니다.');
  let raw: string;
  if (spec === '-') raw = fs.readFileSync(0, 'utf8');
  else raw = fs.readFileSync(path.resolve(spec), 'utf8');
  raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(raw) as Record<string, unknown>; } catch (e) { die(`JSON 파싱 실패: ${(e as Error).message}`); }
}

async function cmdSaveMarks(flags: Map<string, string>, boolFlags: Set<string>) {
  const raw = readJsonInput(flags.get('json'));
  const passageId = flags.get('passage-id') || String(raw.passageId ?? '');
  if (!passageId) die('passageId 가 필요합니다 (JSON.passageId 또는 --passage-id).');
  const passage = await loadPassage(passageId);
  const user = await resolveUser(flags.get('user') || (raw.user ? String(raw.user) : undefined));
  const mode = (flags.get('mode') || String(raw.mode ?? 'merge')).toLowerCase();
  if (mode !== 'merge' && mode !== 'replace') die(`mode 는 merge|replace: ${mode}`);
  const inMarks = Array.isArray(raw.marks) ? raw.marks : die('marks 배열이 필요합니다.');
  if (inMarks.length === 0) die('marks 가 비어 있습니다.');

  const resolved: StudioMark[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  inMarks.forEach((rm, i) => {
    const o = (rm && typeof rm === 'object') ? rm as Record<string, unknown> : {};
    const scope = (STUDIO_MARK_SCOPES as readonly string[]).includes(String(o.scope)) ? String(o.scope) as StudioMark['scope'] : 'word';
    const target = collapse(o.target);
    if (!target) { errors.push(`#${i + 1}: target 누락`); return; }
    const qTypesRaw = Array.isArray(o.qTypes) ? o.qTypes.map((x) => String(x).trim()).filter(Boolean) : [];
    for (const qt of qTypesRaw) if (!(STUDIO_QTYPES as readonly string[]).includes(qt)) warnings.push(`#${i + 1}: 알 수 없는 유형 '${qt}' (저장은 됨)`);
    const note = String(o.note ?? '');
    let start: number, end: number;
    if (typeof o.start === 'number' && o.start >= 0) {
      start = Math.floor(o.start);
      end = typeof o.end === 'number' && o.end > start ? Math.floor(o.end) : start + target.length;
    } else {
      const occ = Number(o.occurrence ?? 1) || 1;
      const r = findOccurrence(passage.original, target, occ);
      if (!r) { errors.push(`#${i + 1}: '${target}' (occurrence ${occ}) 를 원문에서 찾지 못함`); return; }
      start = r.start; end = r.end;
    }
    resolved.push({ scope, target, qTypes: [...new Set(qTypesRaw)], note, start, end });
  });
  if (errors.length) die(`저장 거부 — 위치 해결 실패:\n  ${errors.join('\n  ')}`);

  const db = await getDb('gomijoshua');
  const existingDoc = await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).findOne({ userId: user.userId, passageId });
  const existing = mode === 'replace' ? [] : normalizeStudioMarks(existingDoc?.marks);
  // 기존 마크의 '실효 위치'(레거시 start 없으면 첫 등장으로 환산) — UI 의 위치기반 중복 방지와 동일
  const effStart = (m: StudioMark): number | null => {
    if (typeof m.start === 'number' && m.start >= 0) return m.start;
    const r = findOccurrence(passage.original, m.target, 1);
    return r ? r.start : null;
  };
  const merged = [...existing];
  let added = 0, skipped = 0;
  for (const nm of resolved) {
    if (merged.some((e) => { const es = effStart(e); return es !== null && Math.abs(es - (nm.start ?? -1)) < 1; })) { skipped++; continue; }
    merged.push(nm); added++;
  }
  const finalMarks = normalizeStudioMarks(merged);
  const summary = {
    passageId, user: user.name || user.loginId, mode,
    inputMarks: inMarks.length, added, skipped, totalMarks: finalMarks.length,
    typeCounts: countByType(finalMarks), grammarStatus: grammarStatus(finalMarks),
    warnings,
  };

  if (boolFlags.has('dry-run')) { out({ dryRun: true, ...summary }); return; }

  await ensureStudioIndexes(db);
  const now = new Date();
  await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).updateOne(
    { userId: user.userId, passageId },
    {
      $set: { marks: finalMarks, userName: user.name || user.loginId, loginId: user.loginId, updatedAt: now },
      $setOnInsert: {
        userId: user.userId, passageId, createdAt: now, problems: [],
        textbook: passage.textbook, sourceKey: passage.sourceKey,
        source: [passage.textbook, passage.sourceKey].filter(Boolean).join(' · '), examType: '',
      },
    },
    { upsert: true },
  );
  out({ ok: true, saved: true, ...summary });
}

/* ─── help / main ───────────────────────────────────────────────────────── */
function helpText(): string {
  return [
    'cc:studio — 출제 스튜디오 출제 포인트(marks) Pro 전용 CLI (API 키 없음)',
    '',
    '  exams      --user <email|loginId|이름> [--school "..."] [--grade 1]',
    '  exam       --id <examId>                      시험범위 지문 + passageId',
    '  find       --textbook "..." [--source "..."]  모의고사 지문 passageId',
    '  passage    --id <passageId> [--user <...>]    원문 + 문장표 + 현재 마크/카운트',
    '  export     <passageId> --user <...>           현재 marks 를 save JSON 으로 덤프',
    '  save-marks --json <file|-> [--dry-run] [--passage-id <pid>] [--user <...>] [--mode merge|replace]',
    '',
    '  단축:  npm run cc:studio -- <passageId>   → passage --id <passageId>',
    '',
    'save-marks JSON: { passageId, user, mode(merge|replace), marks:[{scope,target,qTypes[],note,occurrence}] }',
    '  위치(start/end)는 target 의 occurrence(기본1)번째 등장으로 CLI 가 자동 고정. problems 는 안 건드림.',
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(helpText()); process.exit(0); }

  const known = new Set(['exams', 'exam', 'find', 'passage', 'export', 'save-marks', 'help']);
  let cmd: string, tail: string[];
  if (!argv[0].startsWith('--') && !known.has(argv[0]) && /^[a-f0-9]{24}$/i.test(argv[0])) {
    cmd = 'passage'; tail = ['--id', argv[0], ...argv.slice(1)]; // 단축: passageId 만 → passage
  } else { cmd = argv[0]; tail = argv.slice(1); }
  const { flags, positional, boolFlags } = parseFlags(tail);

  switch (cmd) {
    case 'exams': await cmdExams(flags); break;
    case 'exam': await cmdExam(flags); break;
    case 'find': await cmdFind(flags); break;
    case 'passage': await cmdPassage(flags); break;
    case 'export': await cmdExport(positional, flags); break;
    case 'save-marks': await cmdSaveMarks(flags, boolFlags); break;
    case 'help': console.log(helpText()); break;
    default: die(`알 수 없는 명령: ${cmd}\n\n${helpText()}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
