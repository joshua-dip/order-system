import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import { loadKitPassagesByIds } from '@/lib/workbook-kit/load-passages';
import type { KitMaterialType } from '@/lib/workbook-kit/types';
import { KIT_TYPE_LABEL } from '@/lib/workbook-kit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID = new Set(Object.keys(KIT_TYPE_LABEL));

/**
 * POST body: { passageIds: string[], types: KitMaterialType[], includeTranslation?: boolean }
 * → HTML 미리보기용 엔트리 (pdf 는 /pdf, /pdf-bulk)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { passageIds?: unknown; types?: unknown; includeTranslation?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const passageIds = Array.isArray(body.passageIds)
    ? body.passageIds.filter((v): v is string => typeof v === 'string').slice(0, 80)
    : [];
  const types = Array.isArray(body.types)
    ? body.types.filter((v): v is KitMaterialType => typeof v === 'string' && VALID.has(v))
    : [];
  if (!passageIds.length) return NextResponse.json({ error: 'passageIds 가 필요합니다.' }, { status: 400 });
  if (!types.length) return NextResponse.json({ error: 'types 가 필요합니다.' }, { status: 400 });

  const passages = await loadKitPassagesByIds(passageIds);
  if (!passages.length) return NextResponse.json({ error: '지문을 찾지 못했습니다.' }, { status: 404 });

  const entries = await buildWorkbookKitEntries(passages, {
    types,
    includeTranslation: body.includeTranslation !== false,
  });

  return NextResponse.json({
    ok: true,
    textbook: passages[0].textbook,
    passageCount: passages.length,
    entries: entries.map((e) => ({
      type: e.type,
      fileName: e.fileName,
      title: e.title,
      questionCount: e.questionCount,
      warning: e.warning ?? null,
      html: e.html || null,
    })),
  });
}
