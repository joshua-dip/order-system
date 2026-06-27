import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col } from '@/lib/vip-db';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `교재::sourceKey` → {textbook, sourceKey} */
function parseKey(key: string): { textbook: string; sourceKey: string } {
  const idx = key.indexOf('::');
  if (idx < 0) return { textbook: '', sourceKey: key };
  return { textbook: key.slice(0, idx), sourceKey: key.slice(idx + 2) };
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 학교 시험지 생성기용 — '이번 시험범위(scope)' 지문의 서술형 변형(narrative_questions, 주제완성형)을 가져온다.
 * 기출 패턴 서술형(범위 밖)을 대체. 서술형 형식(발문·지문·주제틀 빈칸·주어진표현·조건)을 paragraph 에 HTML 로 임베드해
 * 기존 서술형 렌더(미리보기·다운로드)를 그대로 재사용한다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const scopeExamId = sp.get('scopeExamId') ?? '';
  const limit = Math.min(20, Math.max(0, Number(sp.get('limit') || '6')));
  const subtype = (sp.get('subtype') || '주제완성형').trim();
  if (!ObjectId.isValid(scopeExamId)) return NextResponse.json({ ok: true, subjectives: [] });
  if (limit === 0) return NextResponse.json({ ok: true, subjectives: [] });

  const vipDb = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const scopeExam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(scopeExamId), userId: uid });
  if (!scopeExam) return NextResponse.json({ ok: true, subjectives: [] });
  const keys: string[] = Array.isArray((scopeExam as Record<string, unknown>).examScopePassages)
    ? ((scopeExam as Record<string, unknown>).examScopePassages as string[]).map(String)
    : [];
  const pairs = keys.map(parseKey).filter((p) => p.sourceKey);
  if (pairs.length === 0) return NextResponse.json({ ok: true, subjectives: [] });

  const db = await getDb('gomijoshua');
  // 범위 (교재,source_key) → passage_id 정밀 매칭(교재 충돌 방지)
  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const passages = await db.collection('passages').find({ $or: or }, { projection: { _id: 1, textbook: 1, source_key: 1 } }).toArray();
  if (passages.length === 0) return NextResponse.json({ ok: true, subjectives: [] });
  const pidToMeta = new Map(passages.map((p) => [String(p._id), { textbook: String(p.textbook ?? ''), source: String(p.source_key ?? '') }]));
  const pids = passages.map((p) => p._id as ObjectId);

  // 범위 지문의 서술형 변형 (주제완성형) — 지문당 1개, 서로 다른 지문에서 limit 개
  const docs = await db.collection('narrative_questions')
    .find({ passage_id: { $in: pids }, narrative_subtype: subtype })
    .project({ passage_id: 1, textbook: 1, question_data: 1 })
    .toArray();
  // 지문별 1개로 추리기 + 셔플
  const byPassage = new Map<string, Record<string, unknown>>();
  for (const d of docs) {
    const pid = String(d.passage_id);
    if (!byPassage.has(pid)) byPassage.set(pid, d);
  }
  const picked = [...byPassage.values()];
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picked[i], picked[j]] = [picked[j], picked[i]]; }
  const chosen = picked.slice(0, limit);

  const subjectives = chosen.map((d) => {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const S = (k: string) => (typeof qd[k] === 'string' ? (qd[k] as string) : '');
    const meta = pidToMeta.get(String(d.passage_id)) ?? { textbook: String(d.textbook ?? ''), source: '' };
    const frame = S('주제틀');
    const given = S('주어진표현');
    const condLines = S('조건').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    // 발문 + 지문 + 주제틀 빈칸 + 주어진표현 + 조건 을 paragraph 에 임베드(HTML)
    const parts: string[] = [];
    parts.push(esc(S('본문')));
    parts.push('');
    if (frame) parts.push(`<b>${esc(frame)}</b> ______________________________`);
    if (given) parts.push(`[주어진 표현]  ${esc(given)}`);
    if (condLines.length) { parts.push('[조건]'); for (const c of condLines) parts.push(esc(c)); }
    const paragraph = parts.join('<br/>');
    return {
      question: S('문제') || '주어진 글 속의 어구를 활용하여, 다음 글의 주제를 완성하시오.',
      paragraph,
      source: meta.source,
      textbook: meta.textbook,
      score: Number(qd['점수']) || 5,
      // 정답(교사용) — 다운로드 답안지에서 쓸 수 있게 함께 전달
      modelAnswer: S('완전한문제') || S('모범답안'),
      subtype,
    };
  });

  return NextResponse.json({ ok: true, subjectives, available: byPassage.size });
}
