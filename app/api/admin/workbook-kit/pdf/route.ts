import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import { loadKitPassagesByIds } from '@/lib/workbook-kit/load-passages';
import type { KitMaterialType } from '@/lib/workbook-kit/types';
import { KIT_TYPE_LABEL } from '@/lib/workbook-kit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VALID = new Set(Object.keys(KIT_TYPE_LABEL));

/**
 * 단건(또는 첫 유효 엔트리) PDF.
 * body: { passageIds, types, includeTranslation?, type? }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { passageIds?: unknown; types?: unknown; includeTranslation?: unknown; type?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const passageIds = Array.isArray(body.passageIds)
    ? body.passageIds.filter((v): v is string => typeof v === 'string').slice(0, 80)
    : [];
  let types = Array.isArray(body.types)
    ? body.types.filter((v): v is KitMaterialType => typeof v === 'string' && VALID.has(v))
    : [];
  if (typeof body.type === 'string' && VALID.has(body.type)) {
    types = [body.type as KitMaterialType];
  }
  if (!passageIds.length || !types.length) {
    return NextResponse.json({ error: 'passageIds 와 types 가 필요합니다.' }, { status: 400 });
  }

  const passages = await loadKitPassagesByIds(passageIds);
  if (!passages.length) return NextResponse.json({ error: '지문을 찾지 못했습니다.' }, { status: 404 });

  const entries = await buildWorkbookKitEntries(passages, {
    types,
    includeTranslation: body.includeTranslation !== false,
  });
  const hit = entries.find((e) => e.html);
  if (!hit) {
    const warn = entries.map((e) => e.warning).filter(Boolean).join(' / ') || '생성할 HTML이 없습니다.';
    return NextResponse.json({ error: warn }, { status: 422 });
  }

  const pdf = await renderHtmlToPdf(hit.html, {
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
  });
  const fileName = hit.fileName.replace(/\.pdf$/i, '') + '.pdf';
  const encoded = encodeURIComponent(fileName);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="workbook-kit.pdf"; filename*=UTF-8''${encoded}`,
    },
  });
}
