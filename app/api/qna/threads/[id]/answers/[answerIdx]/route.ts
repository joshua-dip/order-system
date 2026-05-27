import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { deleteAnswer, getThread } from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/qna/threads/[id]/answers/[answerIdx]
 *
 * admin 전용. 답변이 0개가 되면 thread status 가 자동으로 'open' 으로 되돌아감 (store 안에서 처리).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; answerIdx: string }> },
) {
  const { id, answerIdx } = await context.params;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });
  }

  const idx = Number(answerIdx);
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: '잘못된 answerIdx 입니다.' }, { status: 400 });
  }

  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ error: '질문을 찾을 수 없습니다.' }, { status: 404 });
  }

  const ok = await deleteAnswer(id, idx);
  if (!ok) {
    return NextResponse.json({ error: '답변 삭제에 실패했습니다.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
