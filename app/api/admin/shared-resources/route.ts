import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { createSharedResource, listSharedResources } from '@/lib/shared-resources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const items = await listSharedResources();
    return NextResponse.json({ items });
  } catch (e) {
    console.error('[admin/shared-resources GET]', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { title?: string; subtitle?: string; blogUrl?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const title = (body.title ?? '').trim();
  const blogUrl = (body.blogUrl ?? '').trim();
  if (!title) return NextResponse.json({ error: '자료명을 입력해 주세요.' }, { status: 400 });
  if (!blogUrl) return NextResponse.json({ error: '블로그 링크를 입력해 주세요.' }, { status: 400 });
  if (!/^https?:\/\//i.test(blogUrl)) {
    return NextResponse.json({ error: '블로그 링크는 http:// 또는 https:// 로 시작해야 합니다.' }, { status: 400 });
  }

  try {
    const id = await createSharedResource({ title, subtitle: body.subtitle, blogUrl });
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[admin/shared-resources POST]', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
