import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  deleteThread,
  getThread,
  updateThreadStatus,
  verifyOwnerToken,
  type QnaThreadStatus,
} from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

const OWNER_TOKEN_HEADER = 'x-qna-owner-token';
const VALID_STATUSES: QnaThreadStatus[] = ['open', 'answered', 'hidden'];

/**
 * PATCH /api/qna/threads/[id]
 *
 * admin 전용. body: { status: 'open'|'answered'|'hidden' }.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const status = String(body.status ?? '') as QnaThreadStatus;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: '잘못된 status 입니다.' }, { status: 400 });
  }

  const existing = await getThread(id);
  if (!existing) {
    return NextResponse.json({ error: '질문을 찾을 수 없습니다.' }, { status: 404 });
  }

  const ok = await updateThreadStatus(id, status);
  return NextResponse.json({ ok });
}

/**
 * DELETE /api/qna/threads/[id]
 *
 * - admin 은 항상 가능 (실제 deleteOne).
 * - 비로그인 작성자는 `x-qna-owner-token` 헤더 해시 일치 + `answers.length === 0` 일 때만 진짜 삭제.
 *   답변이 1개 이상이면 `status='hidden'` 으로 전환만 (admin 노동 보호).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  const isAdmin = !!payload && payload.role === 'admin';

  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ error: '질문을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (isAdmin) {
    const ok = await deleteThread(id);
    return NextResponse.json({ ok, mode: 'deleted' });
  }

  // owner 토큰 확인
  const ownerToken = request.headers.get(OWNER_TOKEN_HEADER) || '';
  if (!verifyOwnerToken(ownerToken, thread.ownerTokenHash)) {
    return NextResponse.json({ error: '본인 글만 삭제할 수 있습니다.' }, { status: 403 });
  }

  if ((thread.answers ?? []).length > 0) {
    const ok = await updateThreadStatus(id, 'hidden');
    return NextResponse.json({ ok, mode: 'hidden' });
  }

  const ok = await deleteThread(id);
  return NextResponse.json({ ok, mode: 'deleted' });
}
