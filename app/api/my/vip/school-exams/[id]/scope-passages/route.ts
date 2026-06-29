import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `교재::sourceKey` → {textbook, sourceKey} */
function parseKey(key: string): { textbook: string; sourceKey: string } {
  const idx = key.indexOf('::');
  if (idx < 0) return { textbook: '', sourceKey: key };
  return { textbook: key.slice(0, idx), sourceKey: key.slice(idx + 2) };
}

/**
 * GET — 시험범위 지문(examScopePassages)별 전체 영어 원문 + passageId.
 * '시험 출제 포인트'에서 시험범위 지문을 원문과 함께 분석할 때 사용.
 * 응답: { ok, exam:{examType,academicYear,grade,schoolId}, passages:[{key,textbook,sourceKey,passageId,original}] }
 *   passages 는 교재 그룹(시험범위 순서) 안에서 번호(sourceKey) 이름순 정렬.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const exam = await db.collection('vip_school_exams').findOne(
    { _id: new ObjectId(id), userId },
    { projection: { examScopePassages: 1, examType: 1, academicYear: 1, grade: 1, schoolId: 1 } },
  );
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const keys: string[] = Array.isArray(exam.examScopePassages) ? exam.examScopePassages.map(String) : [];
  const pairs = keys.map((k) => ({ key: k, ...parseKey(k) })).filter((p) => p.sourceKey);

  const examMeta = {
    examType: String(exam.examType ?? ''),
    academicYear: Number(exam.academicYear ?? 0),
    grade: Number(exam.grade ?? 0),
    schoolId: exam.schoolId ? String(exam.schoolId) : '',
  };
  if (pairs.length === 0) return NextResponse.json({ ok: true, exam: examMeta, passages: [] });

  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const docs = await db
    .collection('passages')
    .find({ $or: or }, { projection: { _id: 1, textbook: 1, source_key: 1, 'content.original': 1 } })
    .toArray();

  // (textbook::sourceKey) → {passageId, original}
  const lookup = new Map<string, { passageId: string; original: string }>();
  for (const d of docs) {
    const tb = String(d.textbook ?? '');
    const sk = String(d.source_key ?? '');
    const en = String((d.content as { original?: unknown })?.original ?? '').replace(/\s+/g, ' ').trim();
    lookup.set(`${tb}::${sk}`, { passageId: String(d._id), original: en });
    // textbook 없이 들어온 범위 항목 대비(소스키만으로도 매칭)
    if (!lookup.has(`::${sk}`)) lookup.set(`::${sk}`, { passageId: String(d._id), original: en });
  }

  // 교재 그룹(시험범위 등장 순서 유지) + 그룹 내 번호 이름순 정렬
  const order: string[] = [];
  const byTb = new Map<string, typeof pairs>();
  for (const p of pairs) {
    if (!byTb.has(p.textbook)) { byTb.set(p.textbook, []); order.push(p.textbook); }
    byTb.get(p.textbook)!.push(p);
  }
  const passages: { key: string; textbook: string; sourceKey: string; passageId: string; original: string }[] = [];
  for (const tb of order) {
    const list = byTb.get(tb)!.slice().sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'ko', { numeric: true }));
    for (const p of list) {
      const hit = lookup.get(`${p.textbook}::${p.sourceKey}`) ?? lookup.get(`::${p.sourceKey}`);
      passages.push({
        key: p.key,
        textbook: p.textbook,
        sourceKey: p.sourceKey,
        passageId: hit?.passageId ?? '',
        original: hit?.original ?? '',
      });
    }
  }

  return NextResponse.json({ ok: true, exam: examMeta, passages });
}
