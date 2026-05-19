import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listEssayExams, listFolderCounts, listFolders, saveEssayExam } from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/essay-generator/exams
 *   - 기본: 전체 items (limit 5000) + 폴더 목록 + 폴더별 카운트
 *   - ?folder=<이름>: 그 폴더의 items 만 (limit 없음) + 폴더 목록 + 카운트
 *     큰 컬렉션에서 사이드바 카운트는 정확히 표시되면서 본문은 선택 폴더만 가볍게.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const folder = request.nextUrl.searchParams.get('folder')?.trim();

  try {
    const [items, folders, folderCounts] = await Promise.all([
      listEssayExams(folder ? { folder } : undefined),
      listFolders(),
      listFolderCounts(),
    ]);
    return NextResponse.json({ items, folders, folderCounts });
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
    isPlaceholder?: boolean;
    data?: object;
    html?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  if (!body.data) {
    return NextResponse.json({ error: 'data가 필요합니다.' }, { status: 400 });
  }
  const isPlaceholder = body.isPlaceholder === true;
  const html = typeof body.html === 'string' ? body.html : '';
  if (!isPlaceholder && html.trim() === '') {
    return NextResponse.json({ error: 'html이 필요합니다.' }, { status: 400 });
  }

  try {
    const id = await saveEssayExam({
      title: body.title ?? '',
      textbook: body.textbook ?? '',
      sourceKey: body.sourceKey ?? '',
      difficulty: body.difficulty ?? '',
      folder: body.folder ?? '기본',
      ...(isPlaceholder ? { isPlaceholder: true as const } : {}),
      data: body.data,
      html,
    });
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[essay-exams POST]', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
