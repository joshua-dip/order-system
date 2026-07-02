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
  // 기본은 주제완성형 + 요약문빈칸완성형 혼합. subtypes 파라미터로 특정 유형만 지정 가능.
  const subtypes = (sp.get('subtypes') || sp.get('subtype') || '주제완성형,요약문빈칸완성형')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const subjSet = (sp.get('subjSet') || '').trim(); // 세트(폴더)로 작성한 새 서술형만 — 없으면 전체 풀로 폴백
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

  // 범위 지문의 서술형 변형 (주제완성형·요약문빈칸완성형) — 지문당 1개, 서로 다른 지문에서 limit 개
  const proj = { passage_id: 1, textbook: 1, narrative_subtype: 1, question_data: 1 };
  // subjSet(세트) 지정 시 그 마커로 작성한 새 서술형만 — 결과 없으면 전체 풀로 폴백(다른 세트 호환)
  let docs = subjSet
    ? await db.collection('narrative_questions').find({ passage_id: { $in: pids }, subj_set: subjSet }).project(proj).toArray()
    : [];
  if (docs.length === 0) {
    docs = await db.collection('narrative_questions')
      .find({ passage_id: { $in: pids }, narrative_subtype: { $in: subtypes } }).project(proj).toArray();
  }
  // 먼저 셔플 → 지문별 1개(랜덤 유형) → limit 개. (한 지문이 두 유형을 가져도 한 문항만)
  for (let i = docs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [docs[i], docs[j]] = [docs[j], docs[i]]; }
  const byPassage = new Map<string, Record<string, unknown>>();
  for (const d of docs) { const pid = String(d.passage_id); if (!byPassage.has(pid)) byPassage.set(pid, d); }
  const chosen = [...byPassage.values()].slice(0, limit);

  // 유형별 paragraph 임베드 (지문 + 빈칸틀/요약문 + 조건) — 기존 서술형 렌더 재사용
  const buildParagraph = (subtype: string, qd: Record<string, unknown>): string => {
    const S = (k: string) => (typeof qd[k] === 'string' ? (qd[k] as string) : '');
    const condLines = S('조건').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const parts: string[] = [esc(S('본문')), ''];
    if (subtype === '요약문빈칸완성형') {
      const blanks = Array.isArray(qd['빈칸들']) ? (qd['빈칸들'] as Record<string, unknown>[]) : [];
      let summaryHtml = esc(S('요약문'));
      for (const b of blanks) { const label = String(b?.['기호'] ?? ''); if (label) summaryHtml = summaryHtml.split(`(${label})`).join(`______(${esc(label)})______`); }
      parts.push('[요약문]', summaryHtml, '');
      if (condLines.length) { parts.push('[조건]'); for (const c of condLines) parts.push(esc(c)); parts.push(''); }
      const wordRow = blanks.map((b) => `(${esc(String(b?.['기호'] ?? ''))}) ${Number(b?.['단어수']) || 0}단어`).join('      ');
      if (wordRow) parts.push(esc(wordRow));
    } else {
      // 주제완성형
      const frame = S('주제틀'); const given = S('주어진표현');
      if (frame) parts.push(`<b>${esc(frame)}</b> ______________________________`);
      if (given) parts.push(`[주어진 표현]  ${esc(given)}`);
      if (condLines.length) { parts.push('[조건]'); for (const c of condLines) parts.push(esc(c)); }
    }
    return parts.join('<br/>');
  };

  const subjectives = chosen.map((d) => {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const S = (k: string) => (typeof qd[k] === 'string' ? (qd[k] as string) : '');
    const subtype = String(d.narrative_subtype ?? '주제완성형');
    const meta = pidToMeta.get(String(d.passage_id)) ?? { textbook: String(d.textbook ?? ''), source: '' };
    return {
      question: S('문제') || '다음 글을 읽고 서술형 문제에 답하시오.',
      paragraph: buildParagraph(subtype, qd),
      source: meta.source,
      textbook: meta.textbook,
      score: Number(qd['점수']) || 5,
      // 정답·해설(교사용) — 다운로드 답안지/해설지에서 쓸 수 있게 함께 전달
      modelAnswer: S('완전한문제') || S('모범답안'),
      explanation: S('해설'),
      subtype,
    };
  });

  return NextResponse.json({ ok: true, subjectives, available: byPassage.size });
}
