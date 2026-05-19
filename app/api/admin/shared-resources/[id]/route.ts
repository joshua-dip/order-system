import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  deleteSharedResource,
  moveSharedResourceOrder,
  updateSharedResource,
} from '@/lib/shared-resources';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;

  let body: { title?: string; subtitle?: string; blogUrl?: string; move?: 'up' | 'down' };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  try {
    if (body.move === 'up' || body.move === 'down') {
      const ok = await moveSharedResourceOrder(id, body.move);
      if (!ok) return NextResponse.json({ error: '이동할 항목이 없습니다.' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (typeof body.blogUrl === 'string' && body.blogUrl.trim() && !/^https?:\/\//i.test(body.blogUrl.trim())) {
      return NextResponse.json({ error: '블로그 링크는 http:// 또는 https:// 로 시작해야 합니다.' }, { status: 400 });
    }

    const ok = await updateSharedResource(id, {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.subtitle === 'string' ? { subtitle: body.subtitle } : {}),
      ...(typeof body.blogUrl === 'string' ? { blogUrl: body.blogUrl } : {}),
    });
    if (!ok) return NextResponse.json({ error: '항목을 찾지 못했습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/shared-resources PATCH]', e);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  try {
    const ok = await deleteSharedResource(id);
    if (!ok) return NextResponse.json({ error: '항목을 찾지 못했습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/shared-resources DELETE]', e);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
