import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { saveEssayStepWorkbook } from '@/lib/essay-step-workbooks-store';
import { buildEssayStepCombinedHtml, type EssayStepWorkbookData } from '@/lib/essay-step-workbook';
import { validateEssayStepData } from '@/lib/essay-step-validator';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const passageId = typeof body.passageId === 'string' ? body.passageId.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey.trim() : '';
    const folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : '기본';
    const force = body.force === true;
    const data = body.data as EssayStepWorkbookData | undefined;

    if (!textbook || !sourceKey) {
      return NextResponse.json({ error: 'textbook, sourceKey 가 필요합니다.' }, { status: 400 });
    }
    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'data (EssayStepWorkbookData) 가 필요합니다.' }, { status: 400 });
    }

    const validation = validateEssayStepData(data);
    if (!validation.valid && !force) {
      return NextResponse.json(
        { error: '검증 실패', validation, hint: 'force: true 로 우회 가능' },
        { status: 422 },
      );
    }

    const html = buildEssayStepCombinedHtml({ data });
    const title = data.meta?.topic ?? '서술형집중 워크북';

    const id = await saveEssayStepWorkbook({
      title,
      textbook,
      sourceKey,
      passageId: passageId || undefined,
      folder,
      data,
      html,
    });

    return NextResponse.json({ ok: true, id, validation });
  } catch (e) {
    console.error('essay-step/save:', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
