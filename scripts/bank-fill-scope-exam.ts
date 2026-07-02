/**
 * 학교 시험범위(scope) 의 각 지문에서 완료(검수완료) 변형 N개씩 골라 VIP 선생님의 '내 문제'(vip_saved_questions)로 담는다.
 * generated_questions 는 안 건드리고 '담기'(스냅샷 upsert)만 한다. ANTHROPIC API 키 없음.
 *
 *   npx tsx scripts/bank-fill-scope-exam.ts --exam <examId> --user <name|loginId> [--per 3] [--folder "..."] [--dry-run]
 *
 * 지문→passage_id 해석은 by-exam/scope-passage-types 와 동일(지문 자신 + passage_source 원본).
 * 유형은 PREF 순으로 base 우선 distinct → 부족하면 고난도 → 그래도 부족하면 같은 유형 다른 문항으로 채움.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { getVipDb, col } from '@/lib/vip-db';
import {
  QUESTION_BANK_COLLECTION,
  ensureQuestionBankIndexes,
  previewText,
  type SavedQuestionDoc,
} from '@/lib/vip-question-bank-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadCliEnv(path.resolve(__dirname, '..'));

function out(o: unknown) { console.log(JSON.stringify(o, null, 2)); }
function die(m: string): never { console.error(m); process.exit(1); }

function parseFlags(argv: string[]) {
  const flags = new Map<string, string>(); const bool = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n !== undefined && !n.startsWith('--')) { flags.set(k, n); i++; } else bool.add(k); }
  }
  return { flags, bool };
}

/** 시험에 좋은 유형 우선순위 (base). */
const PREF = ['빈칸', '어법', '어휘', '주제', '제목', '순서', '삽입', '함의', '요약', '주장', '일치', '불일치', '무관한문장'];

interface GenDoc { _id: ObjectId; type: string; serialNo?: number; textbook?: string; source?: string; difficulty?: string; question_data?: { Question?: string; Paragraph?: string; Source?: string } }

/** 한 지문(candidate pids)의 완료 변형에서 per 개 선택 — base 우선 distinct, 부족하면 고난도/중복유형 보충. */
function pickPerPassage(docs: GenDoc[], per: number): GenDoc[] {
  const byType = new Map<string, GenDoc[]>();
  for (const d of docs) { const t = String(d.type ?? ''); if (!byType.has(t)) byType.set(t, []); byType.get(t)!.push(d); }
  for (const arr of byType.values()) arr.sort((a, b) => (a.serialNo ?? 0) - (b.serialNo ?? 0) || String(a._id).localeCompare(String(b._id)));
  const chosen: GenDoc[] = [];
  const takenIds = new Set<string>();
  const take = (t: string) => { const arr = byType.get(t); if (!arr) return false; const d = arr.find((x) => !takenIds.has(String(x._id))); if (!d) return false; chosen.push(d); takenIds.add(String(d._id)); return true; };
  // 1) base 우선 distinct
  for (const t of PREF) { if (chosen.length >= per) break; take(t); }
  // 2) PREF 외 base 유형
  if (chosen.length < per) for (const t of [...byType.keys()].filter((t) => !t.endsWith('-고난도') && !PREF.includes(t))) { if (chosen.length >= per) break; take(t); }
  // 3) 고난도 (PREF 순)
  if (chosen.length < per) for (const t of PREF) { if (chosen.length >= per) break; take(`${t}-고난도`); }
  // 4) 남은 아무 유형
  if (chosen.length < per) for (const t of byType.keys()) { if (chosen.length >= per) break; take(t); }
  // 5) 그래도 부족하면 같은 유형 다른 문항 반복
  if (chosen.length < per) { for (const arr of byType.values()) { for (const d of arr) { if (chosen.length >= per) break; if (!takenIds.has(String(d._id))) { chosen.push(d); takenIds.add(String(d._id)); } } if (chosen.length >= per) break; } }
  return chosen.slice(0, per);
}

async function main() {
  const { flags, bool } = parseFlags(process.argv.slice(2));
  const who = flags.get('user'); if (!who) die('--user <name|loginId> 필요');
  const per = Math.max(1, Math.min(10, Number(flags.get('per') ?? 3)));
  const folder = (flags.get('folder') ?? '').slice(0, 100);
  const dryRun = bool.has('dry-run');

  const db = await getDb('gomijoshua');
  const vipDb = await getVipDb();

  // 사용자
  const u = await db.collection('users').findOne({ $or: [{ email: who }, { loginId: who }, { name: who }] }, { projection: { name: 1, loginId: 1 } });
  if (!u) die(`사용자 못 찾음: ${who}`);
  const userId = u._id as ObjectId;

  // --empty-bank: 이 사용자의 내 문제은행(vip_saved_questions) 전체 비우기 (실제 변형문제 generated_questions 는 안 건드림)
  if (bool.has('empty-bank')) {
    const before = await db.collection(QUESTION_BANK_COLLECTION).countDocuments({ userId });
    if (bool.has('dry-run')) { out({ dryRun: true, emptyBank: true, user: u.name || u.loginId, wouldDelete: before }); process.exit(0); }
    const r = await db.collection(QUESTION_BANK_COLLECTION).deleteMany({ userId });
    out({ ok: true, emptyBank: true, user: u.name || u.loginId, deleted: r.deletedCount, before });
    process.exit(0);
  }

  const examId = flags.get('exam'); if (!examId || !ObjectId.isValid(examId)) die('--exam <examId> 필요');
  // 시험 범위
  const exam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(examId), userId });
  if (!exam) die(`시험 못 찾음(이 사용자 소유 아님?): ${examId}`);
  const examScopePassages: string[] = ((exam as Record<string, unknown>).examScopePassages as string[]) ?? [];
  const entries = examScopePassages
    .map((e) => { const s = e.indexOf('::'); return s < 0 ? null : { key: e, tb: e.slice(0, s), sk: e.slice(s + 2) }; })
    .filter((e): e is { key: string; tb: string; sk: string } => !!e && !!e.sk);
  if (entries.length === 0) die('시험범위(examScopePassages)가 비어 있음');

  // 지문 → 후보 passage_id (own + passage_source 원본) — by-exam/scope-passage-types 와 동일
  const allTb = [...new Set(entries.map((e) => e.tb))];
  const allSk = [...new Set(entries.map((e) => e.sk))];
  const pdocs = await db.collection('passages').find({ textbook: { $in: allTb }, source_key: { $in: allSk } }, { projection: { _id: 1, textbook: 1, source_key: 1, passage_source: 1 } }).toArray();
  const ownIdByKey = new Map<string, string>(); const psByKey = new Map<string, string>(); const psKeys: string[] = [];
  for (const p of pdocs) { ownIdByKey.set(`${p.textbook}::${p.source_key}`, String(p._id)); const ps = String((p as Record<string, unknown>).passage_source ?? '').trim(); if (ps) { psByKey.set(`${p.textbook}::${p.source_key}`, ps); psKeys.push(ps); } }
  const psToId = new Map<string, string>();
  if (psKeys.length) { const od = await db.collection('passages').find({ source_key: { $in: psKeys } }, { projection: { _id: 1, source_key: 1 } }).toArray(); for (const o of od) psToId.set(String(o.source_key), String(o._id)); }

  // entry → 후보 passage_id 들 (공통)
  const pidsForEntry = (e: { key: string }): ObjectId[] => {
    const ids: ObjectId[] = [];
    const own = ownIdByKey.get(e.key); if (own) ids.push(new ObjectId(own));
    const ps = psByKey.get(e.key); if (ps) { const o = psToId.get(ps); if (o) ids.push(new ObjectId(o)); }
    return ids;
  };

  // --report: 지문별 (완료 총수 / 내 문제은행에 이미 담긴 수 / 안 쓴 수) 집계만
  if (bool.has('report')) {
    const bankIds = new Set((await db.collection(QUESTION_BANK_COLLECTION).find({ userId }).project({ questionId: 1 }).limit(50000).toArray()).map((s) => String(s.questionId)));
    let totalDone = 0, totalInBank = 0; const perRows: { p: string; done: number; inBank: number; unused: number }[] = [];
    for (const e of entries) {
      const pids = pidsForEntry(e); if (pids.length === 0) { perRows.push({ p: e.sk, done: 0, inBank: 0, unused: 0 }); continue; }
      const ids = (await db.collection('generated_questions').find({ status: '완료', passage_id: { $in: pids } }).project({ _id: 1 }).toArray()).map((d) => String(d._id));
      const inBank = ids.filter((id) => bankIds.has(id)).length;
      totalDone += ids.length; totalInBank += inBank;
      perRows.push({ p: e.sk, done: ids.length, inBank, unused: ids.length - inBank });
    }
    const minUnused = Math.min(...perRows.map((r) => r.unused));
    out({ report: true, user: u.name || u.loginId, passages: entries.length, totalDone, totalInBank, totalUnused: totalDone - totalInBank, minUnusedPerPassage: minUnused, passagesUnder3Unused: perRows.filter((r) => r.unused < per).map((r) => `${r.p}(${r.unused})`) });
    process.exit(0);
  }

  // 지문별 선택
  const proj = { _id: 1, type: 1, serialNo: 1, textbook: 1, source: 1, difficulty: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Source': 1 };

  // --newest N: 시험범위에서 가장 최근 생성된 완료 변형 N개를 folder 로 담기 (방금 만든 세트 담기용)
  if (flags.get('newest')) {
    const N = Math.max(1, Math.min(500, Number(flags.get('newest'))));
    const allPids: ObjectId[] = [];
    for (const e of entries) for (const p of pidsForEntry(e)) allPids.push(p);
    const docs = await db.collection('generated_questions').find({ status: '완료', passage_id: { $in: allPids } }).project(proj).sort({ _id: -1 }).limit(N).toArray() as unknown as GenDoc[];
    const tcN: Record<string, number> = {}; for (const d of docs) tcN[d.type] = (tcN[d.type] ?? 0) + 1;
    if (bool.has('dry-run')) { out({ dryRun: true, newestBanked: true, folder: folder || '(미분류)', requested: N, found: docs.length, typeCounts: tcN, sources: docs.map((d) => `${d.source}(${d.type})`) }); process.exit(0); }
    await ensureQuestionBankIndexes(db);
    const now = new Date();
    const ops = docs.map((d) => {
      const qd = d.question_data ?? {};
      const set: SavedQuestionDoc = { userId, questionId: d._id, serialNo: typeof d.serialNo === 'number' ? d.serialNo : undefined, type: String(d.type ?? ''), textbook: String(d.textbook ?? ''), source: String(d.source ?? qd.Source ?? ''), difficulty: String(d.difficulty ?? ''), question: previewText(qd.Question, 90), preview: previewText(qd.Paragraph, 140), folder, tags: [], savedAt: now };
      const { folder: f, ...rest } = set;
      return { updateOne: { filter: { userId, questionId: d._id }, update: { $setOnInsert: rest, $set: { folder: f } }, upsert: true } };
    });
    let added = 0; if (ops.length) { const r = await db.collection(QUESTION_BANK_COLLECTION).bulkWrite(ops, { ordered: false }); added = r.upsertedCount; }
    out({ ok: true, newestBanked: true, folder: folder || '(미분류)', requested: N, banked: docs.length, added, typeCounts: tcN });
    process.exit(0);
  }
  const selected: GenDoc[] = [];
  const perPassage: { passage: string; picked: number; types: string[]; pids: number }[] = [];
  const shortPassages: string[] = [];
  for (const e of entries) {
    const pids: ObjectId[] = [];
    const own = ownIdByKey.get(e.key); if (own) pids.push(new ObjectId(own));
    const ps = psByKey.get(e.key); if (ps) { const o = psToId.get(ps); if (o) pids.push(new ObjectId(o)); }
    if (pids.length === 0) { shortPassages.push(`${e.sk} (지문 없음)`); continue; }
    const docs = await db.collection('generated_questions').find({ status: '완료', passage_id: { $in: pids } }).project(proj).toArray() as unknown as GenDoc[];
    const pick = pickPerPassage(docs, per);
    if (pick.length < per) shortPassages.push(`${e.sk} (${pick.length}/${per})`);
    selected.push(...pick);
    perPassage.push({ passage: e.sk, picked: pick.length, types: pick.map((d) => d.type), pids: pids.length });
  }

  // 스냅샷 upsert (담기 API 와 동일)
  const now = new Date();
  const ops = selected.map((d) => {
    const qd = d.question_data ?? {};
    const set: SavedQuestionDoc = {
      userId, questionId: d._id,
      serialNo: typeof d.serialNo === 'number' ? d.serialNo : undefined,
      type: String(d.type ?? ''), textbook: String(d.textbook ?? ''),
      source: String(d.source ?? qd.Source ?? ''), difficulty: String(d.difficulty ?? ''),
      question: previewText(qd.Question, 90), preview: previewText(qd.Paragraph, 140),
      folder, tags: [], savedAt: now,
    };
    // folder 는 항상 이 시험 세트로 모음($set) — 나머지 스냅샷은 최초 담을 때만($setOnInsert)
    const { folder: f, ...rest } = set;
    return { updateOne: { filter: { userId, questionId: d._id }, update: { $setOnInsert: rest, $set: { folder: f } }, upsert: true } };
  });

  const typeBreakdown: Record<string, number> = {};
  for (const d of selected) typeBreakdown[d.type] = (typeBreakdown[d.type] ?? 0) + 1;

  const summary = {
    user: u.name || u.loginId, examId,
    scopePassages: entries.length, perPassage: per, totalSelected: selected.length,
    folder: folder || '(미분류)',
    shortPassages, typeBreakdown,
  };

  if (dryRun) { out({ dryRun: true, ...summary, sample: perPassage.slice(0, 6) }); process.exit(0); }

  await ensureQuestionBankIndexes(db);
  let added = 0;
  if (ops.length) { const r = await db.collection(QUESTION_BANK_COLLECTION).bulkWrite(ops, { ordered: false }); added = r.upsertedCount; }
  out({ ok: true, saved: true, ...summary, added, alreadyInBank: selected.length - added });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
