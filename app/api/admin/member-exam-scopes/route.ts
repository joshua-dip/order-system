import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  MEMBER_EXAM_SCOPE_COLLECTION,
  ensureMemberExamScopeIndexes,
  normalizeScopeInput,
} from '@/lib/member-exam-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 관리자 — 회원 시험범위 목록. loginId 로 그 회원 것만, textbook 으로 교재 역조회. */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const loginId = (sp.get('loginId') ?? '').trim();
  const textbook = (sp.get('textbook') ?? '').trim();

  const filter: Record<string, unknown> = {};
  if (loginId) filter.loginId = loginId;
  if (textbook) filter.textbooks = textbook;

  const db = await getDb('gomijoshua');
  await ensureMemberExamScopeIndexes(db);
  const docs = await db
    .collection(MEMBER_EXAM_SCOPE_COLLECTION)
    .find(filter)
    .sort({ year: -1, semester: 1, createdAt: -1 })
    .limit(200)
    .toArray();

  return NextResponse.json({
    ok: true,
    items: docs.map((d) => ({ ...d, _id: undefined, id: String(d._id), userId: String(d.userId) })),
  });
}

/** 관리자 — 회원 시험범위 추가 */
export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const loginId = typeof raw.loginId === 'string' ? raw.loginId.trim() : '';
  if (!loginId) return NextResponse.json({ ok: false, error: '회원 정보가 없습니다.' }, { status: 400 });

  const input = normalizeScopeInput(raw);
  if (input.textbooks.length === 0 && !input.scopeDetail && !input.note) {
    return NextResponse.json({ ok: false, error: '교재나 범위를 한 가지는 입력해 주세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  await ensureMemberExamScopeIndexes(db);
  const user = await db.collection('users').findOne({ loginId });
  if (!user) return NextResponse.json({ ok: false, error: '회원을 찾을 수 없습니다.' }, { status: 404 });

  const now = new Date();
  const res = await db.collection(MEMBER_EXAM_SCOPE_COLLECTION).insertOne({
    userId: user._id as ObjectId,
    loginId,
    ...input,
    createdAt: now,
    updatedAt: now,
    createdBy: payload?.loginId ?? 'admin',
  });
  return NextResponse.json({ ok: true, id: String(res.insertedId) });
}
