import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col } from '@/lib/vip-db';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 학교 시험지 생성기 — '지문별 유형 고정' UI 용.
 * 시험범위(scope) 의 각 지문(교재::source_key)이 실제로 보유한 변형 유형(완료)을 집계해 내려준다.
 * 응답: { ok, types: { "교재::source": { "빈칸": 3, "어법": 2, ... } } }
 * (by-exam 과 동일하게 지문 자신 + passage_source 원본 변형까지 후보로 본다.)
 */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const scopeExamId = request.nextUrl.searchParams.get('scopeExamId') ?? '';
  if (!ObjectId.isValid(scopeExamId)) return NextResponse.json({ ok: true, types: {} });

  const vipDb = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const db = await getDb('gomijoshua');

  const scopeExam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(scopeExamId), userId: uid });
  if (!scopeExam) return NextResponse.json({ ok: true, types: {} });

  const examScopePassages: string[] = ((scopeExam as Record<string, unknown>).examScopePassages as string[]) ?? [];
  if (examScopePassages.length === 0) return NextResponse.json({ ok: true, types: {} });

  // 교재::source → {tb, sk}
  const entries = examScopePassages
    .map((e) => { const sep = e.indexOf('::'); return sep < 0 ? null : { key: e, tb: e.slice(0, sep), sk: e.slice(sep + 2) }; })
    .filter((e): e is { key: string; tb: string; sk: string } => !!e && !!e.sk);
  if (entries.length === 0) return NextResponse.json({ ok: true, types: {} });

  const allTextbooks = [...new Set(entries.map((e) => e.tb))];
  const allSourceKeys = [...new Set(entries.map((e) => e.sk))];

  // 지문 문서 로드 (자기 _id + passage_source)
  const passageDocs = await db.collection('passages')
    .find({ textbook: { $in: allTextbooks }, source_key: { $in: allSourceKeys } },
      { projection: { _id: 1, textbook: 1, source_key: 1, passage_source: 1 } }).toArray();
  const ownIdByKey = new Map<string, string>();
  const psByKey = new Map<string, string>();
  const psKeys: string[] = [];
  for (const p of passageDocs) {
    ownIdByKey.set(`${p.textbook}::${p.source_key}`, String(p._id));
    const ps = String((p as Record<string, unknown>).passage_source ?? '').trim();
    if (ps) { psByKey.set(`${p.textbook}::${p.source_key}`, ps); psKeys.push(ps); }
  }
  const psToId = new Map<string, string>();
  if (psKeys.length > 0) {
    const origDocs = await db.collection('passages')
      .find({ source_key: { $in: psKeys } }, { projection: { _id: 1, source_key: 1 } }).toArray();
    for (const op of origDocs) psToId.set(String(op.source_key), String(op._id));
  }

  // entry → 후보 passage_id 들
  const entryPids = new Map<string, string[]>();
  const allPids = new Set<string>();
  for (const e of entries) {
    const ids: string[] = [];
    const own = ownIdByKey.get(e.key); if (own) ids.push(own);
    const ps = psByKey.get(e.key); if (ps) { const o = psToId.get(ps); if (o) ids.push(o); }
    const uniq = [...new Set(ids)];
    entryPids.set(e.key, uniq);
    for (const id of uniq) allPids.add(id);
  }
  if (allPids.size === 0) return NextResponse.json({ ok: true, types: {} });

  // passage_id × type 별 완료 문항 수
  const agg = await db.collection('generated_questions').aggregate([
    { $match: { status: '완료', passage_id: { $in: [...allPids].map((h) => new ObjectId(h)) } } },
    { $group: { _id: { pid: '$passage_id', type: '$type' }, n: { $sum: 1 } } },
  ]).toArray();
  const byPid = new Map<string, Record<string, number>>();
  for (const r of agg) {
    const pid = String((r._id as { pid: ObjectId }).pid);
    const type = String((r._id as { type: string }).type);
    if (!byPid.has(pid)) byPid.set(pid, {});
    byPid.get(pid)![type] = (byPid.get(pid)![type] ?? 0) + Number(r.n ?? 0);
  }

  // entry → 보유 유형 합산
  const types: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    const acc: Record<string, number> = {};
    for (const pid of entryPids.get(e.key) ?? []) {
      const m = byPid.get(pid); if (!m) continue;
      for (const [t, n] of Object.entries(m)) acc[t] = (acc[t] ?? 0) + n;
    }
    types[e.key] = acc;
  }

  return NextResponse.json({ ok: true, types });
}
