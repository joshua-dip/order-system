import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 학생 이름 명단(반 단위) 저장·불러오기 — 파이널 학생별 개별 문제지용. exam_scopes 와 동일 패턴. */
const COLLECTION = 'student_rosters';
const MAX_ROSTERS = 30;

async function getLoginId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.loginId ?? null;
}

function normalizeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, 200);
}

/** 저장된 명단 목록 */
export async function GET(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(COLLECTION)
      .find({ loginId })
      .sort({ savedAt: -1 })
      .limit(MAX_ROSTERS)
      .project({ loginId: 0 })
      .toArray();
    const rosters = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name ?? '이름 없음',
      names: Array.isArray(d.names) ? d.names : [],
      savedAt: d.savedAt,
    }));
    return NextResponse.json({ rosters });
  } catch (e) {
    console.error('student-rosters GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/** 명단 저장 */
export async function POST(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: { name?: unknown; names?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return NextResponse.json({ error: '명단 이름을 입력해주세요. (예: 고3 A반)' }, { status: 400 });
  const names = normalizeNames(body.names);
  if (names.length === 0) return NextResponse.json({ error: '학생 이름을 1명 이상 입력해주세요.' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    // 같은 이름이면 덮어쓰기, 아니면 신규(최대 개수 초과 시 가장 오래된 것 삭제)
    const existing = await db.collection(COLLECTION).findOne({ loginId, name }, { projection: { _id: 1 } });
    if (existing) {
      await db.collection(COLLECTION).updateOne({ _id: existing._id }, { $set: { names, savedAt: new Date() } });
      return NextResponse.json({ id: String(existing._id), name, names, updated: true });
    }
    const count = await db.collection(COLLECTION).countDocuments({ loginId });
    if (count >= MAX_ROSTERS) {
      const oldest = await db.collection(COLLECTION).findOne({ loginId }, { sort: { savedAt: 1 }, projection: { _id: 1 } });
      if (oldest) await db.collection(COLLECTION).deleteOne({ _id: oldest._id });
    }
    const doc = { loginId, name, names, savedAt: new Date() };
    const r = await db.collection(COLLECTION).insertOne(doc);
    return NextResponse.json({ id: r.insertedId.toString(), name, names, savedAt: doc.savedAt });
  } catch (e) {
    console.error('student-rosters POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

/** 명단 삭제 */
export async function DELETE(request: NextRequest) {
  const loginId = await getLoginId(request);
  if (!loginId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    const r = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id), loginId });
    if (r.deletedCount === 0) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('student-rosters DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
