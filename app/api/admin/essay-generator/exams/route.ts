import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listEssayExams, listFolders, saveEssayExam } from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const [items, folders] = await Promise.all([listEssayExams(), listFolders()]);
    return NextResponse.json({ items, folders });
  } catch (e) {
    console.error('[essay-exams GET]', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    title?: string;
    textbook?: string;
    sourceKey?: string;
    difficulty?: string;
    folder?: string;
    data?: object;
    html?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  if (!body.data || !body.html) {
    return NextResponse.json({ error: 'data와 html이 필요합니다.' }, { status: 400 });
  }

  try {
    const id = await saveEssayExam({
      title: body.title ?? '',
      textbook: body.textbook ?? '',
      sourceKey: body.sourceKey ?? '',
      difficulty: body.difficulty ?? '',
      folder: body.folder ?? '기본',
      data: body.data,
      html: body.html,
    });
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[essay-exams POST]', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
