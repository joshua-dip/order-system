import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { STUDY_PROGRESS_COLLECTION, parseScopeRef, resolveScopePassages, type ScopeEntry } from '@/lib/study-plan';
import { studyPlanMember } from '../_auth';

export const dynamic = 'force-dynamic';

/** GET ?scope=preset:<id>|school:<id> — 시험범위의 지문 목록 + 지문별 완료 활동 */
export async function GET(request: NextRequest) {
  const me = await studyPlanMember(request);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const ref = parseScopeRef(request.nextUrl.searchParams.get('scope'));
  if (!ref) return NextResponse.json({ error: '시험범위를 골라 주세요.' }, { status: 400 });
  const db = await getDb('gomijoshua');

  let entries: ScopeEntry[] = [];
  let label = '';
  if (ref.kind === 'preset') {
    const d = await db.collection('exam_scopes').findOne({ _id: new ObjectId(ref.id), loginId: me.loginId });
    if (!d) return NextResponse.json({ error: '시험범위를 찾을 수 없습니다.' }, { status: 404 });
    entries = (d.dbEntries ?? []) as ScopeEntry[];
    label = String(d.name ?? '시험범위');
  } else {
    const d = await db.collection('my_school_exam_scopes').findOne({ _id: new ObjectId(ref.id), userId: me.userId });
    if (!d) return NextResponse.json({ error: '시험범위를 찾을 수 없습니다.' }, { status: 404 });
    const school = d.schoolId ? await db.collection('my_schools').findOne({ _id: d.schoolId, userId: me.userId }, { projection: { name: 1 } }) : null;
    entries = (d.dbEntries ?? []) as ScopeEntry[];
    label = [school?.name, d.schoolYear, d.semester].filter(Boolean).join(' · ');
  }

  const passages = await resolveScopePassages(db, entries);
  const scopeKey = `${ref.kind}:${ref.id}`;
  const prog = await db
    .collection(STUDY_PROGRESS_COLLECTION)
    .find({ userId: me.userId, scopeKey, passageId: { $in: passages.map((p) => p.id) } })
    .project({ passageId: 1, done: 1 })
    .toArray();
  const progress: Record<string, string[]> = {};
  for (const p of prog) progress[String(p.passageId)] = Array.isArray(p.done) ? p.done.map(String) : [];

  return NextResponse.json({ scope: { key: scopeKey, label }, passages, progress });
}
