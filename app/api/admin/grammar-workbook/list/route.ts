import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  listGrammarFolders,
  listGrammarWorkbooks,
} from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook') ?? undefined;
  const folder = request.nextUrl.searchParams.get('folder') ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '200');

  try {
    const [items, folderInfo] = await Promise.all([
      listGrammarWorkbooks({
        textbook: textbook ?? undefined,
        folder: folder ?? undefined,
        limit,
      }),
      listGrammarFolders(),
    ]);
    return NextResponse.json({
      ok: true,
      items,
      folders: folderInfo.folders,
      folderCounts: folderInfo.folderCounts,
      total: folderInfo.total,
    });
  } catch (e) {
    console.error('grammar-workbook/list GET:', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}
