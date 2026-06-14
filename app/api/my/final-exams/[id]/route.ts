import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import { deleteFinalExamJob, renameFinalExamJob } from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveLoginId(userId: import('mongodb').ObjectId): Promise<string> {
  const db = await getDb('gomijoshua');
  const me = await db.collection('users').findOne({ _id: userId }, { projection: { loginId: 1 } });
  return typeof me?.loginId === 'string' ? me.loginId : '';
}

/** 시험지 이름 변경. body: { title } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: { title?: unknown };
  try {
    body = (await request.json()) as { title?: unknown };
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: '이름을 입력해 주세요.' }, { status: 400 });

  const loginId = await resolveLoginId(auth.userId);
  if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

  const db = await getDb('gomijoshua');
  const ok = await renameFinalExamJob(db, id, loginId, title);
  if (!ok) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, title: title.slice(0, 120) });
}

/** 시험지 삭제 — 부모면 오답세트·채점기록까지 함께 삭제. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const loginId = await resolveLoginId(auth.userId);
  if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

  const db = await getDb('gomijoshua');
  const r = await deleteFinalExamJob(db, id, loginId);
  if (!r.deleted) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
