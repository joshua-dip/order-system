import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { addAnswer, getThread } from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

const ANSWER_MIN = 1;
const ANSWER_MAX = 4000;

/**
 * POST /api/qna/threads/[id]/answers
 *
 * admin 답변 작성. body: { body: string, authorName?: string }.
 * authorName 미지정 시 payload.loginId 사용.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 답변할 수 있습니다.' }, { status: 403 });
  }

  let body: { body?: unknown; authorName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const answerBody = String(body.body ?? '').trim();
  if (answerBody.length < ANSWER_MIN || answerBody.length > ANSWER_MAX) {
    return NextResponse.json(
      { error: `답변은 ${ANSWER_MIN}~${ANSWER_MAX}자로 입력해주세요.` },
      { status: 400 },
    );
  }

  // 개인정보 보호 정책: payload.loginId 는 답변 작성자명으로 절대 사용하지 않는다.
  // 클라이언트가 별도 authorName 을 보내지 않으면 '관리자' 로 고정.
  // 클라이언트가 보낸 이름이 본인 loginId 와 같다면 의도치 않은 노출이므로 '관리자' 로 대체.
  const rawAuthorName =
    typeof body.authorName === 'string' ? body.authorName.trim() : '';
  const myLoginId = payload.loginId?.trim() || '';
  const looksLikeLoginId =
    !!rawAuthorName && !!myLoginId && rawAuthorName.toLowerCase() === myLoginId.toLowerCase();
  const authorName = !rawAuthorName || looksLikeLoginId ? '관리자' : rawAuthorName;

  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ error: '질문을 찾을 수 없습니다.' }, { status: 404 });
  }

  const updated = await addAnswer(id, {
    body: answerBody,
    author: { name: authorName, userId: payload.sub },
  });

  if (!updated) {
    return NextResponse.json({ error: '답변 작성에 실패했습니다.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, thread: updated });
}
