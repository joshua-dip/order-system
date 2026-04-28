import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { saveBlockWorkbook } from '@/lib/block-workbooks-store';
import type { BlockWorkbookSelection, WorkbookKind } from '@/lib/block-workbook-types';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const passageId = typeof body.passageId === 'string' ? body.passageId.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : '기본';
    const selection = body.selection as BlockWorkbookSelection | undefined;
    const types = Array.isArray(body.types) ? (body.types as WorkbookKind[]) : [];
    const html = body.html && typeof body.html === 'object' ? body.html as Record<WorkbookKind, string> : {};

    if (!textbook || !sourceKey || !title || !selection) {
      return NextResponse.json(
        { error: 'textbook, sourceKey, title, selection 이 필요합니다.' },
        { status: 400 },
      );
    }

    if (!Array.isArray(selection.sentences) || !Array.isArray(selection.blocks)) {
      return NextResponse.json({ error: 'selection 구조가 올바르지 않습니다.' }, { status: 400 });
    }

    if (types.length === 0) {
      return NextResponse.json({ error: '저장할 워크북 유형을 1개 이상 고르세요.' }, { status: 400 });
    }

    const id = await saveBlockWorkbook({
      passageId: passageId || undefined,
      textbook,
      sourceKey,
      title,
      folder,
      selection,
      types,
      html,
    });

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error('block-workbook/save POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
