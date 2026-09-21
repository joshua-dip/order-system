import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { renderHtmlEntriesToZip, renderHtmlToPdf } from '@/lib/chromium-pdf';
import { buildWorkbookKitEntries } from '@/lib/workbook-kit/build';
import { loadKitPassagesByIds } from '@/lib/workbook-kit/load-passages';
import type { KitMaterialType } from '@/lib/workbook-kit/types';
import { KIT_TYPE_LABEL } from '@/lib/workbook-kit/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VALID = new Set(Object.keys(KIT_TYPE_LABEL));

/**
 * body: { passageIds, types, includeTranslation?, format?: 'zip'|'pdf' }
 * zip = 유형(·지문)별 PDF 묶음 / pdf = 유효 HTML을 순서대로 이어 붙인 합본은 어렵므로
 *       첫 번째 유형만 합본이 아니라 zip 권장. format=pdf 면 엔트리를 순서대로 이어 붙인 단일 HTML→PDF.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    passageIds?: unknown;
    types?: unknown;
    includeTranslation?: unknown;
    format?: unknown;
  };
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
  const format = body.format === 'pdf' ? 'pdf' : 'zip';
  if (!passageIds.length || !types.length) {
    return NextResponse.json({ error: 'passageIds 와 types 가 필요합니다.' }, { status: 400 });
  }

  const passages = await loadKitPassagesByIds(passageIds);
  if (!passages.length) return NextResponse.json({ error: '지문을 찾지 못했습니다.' }, { status: 404 });

  const entries = await buildWorkbookKitEntries(passages, {
    types,
    includeTranslation: body.includeTranslation !== false,
  });
  const usable = entries.filter((e) => e.html);
  const warnings = entries.filter((e) => e.warning).map((e) => `${e.title}: ${e.warning}`);
  if (!usable.length) {
    return NextResponse.json(
      { error: warnings.join(' / ') || '생성할 자료가 없습니다.', warnings },
      { status: 422 },
    );
  }

  const margin = { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' };
  const book = passages[0].textbook.replace(/[\\/:*?"<>|]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);

  if (format === 'pdf' && usable.length === 1) {
    const pdf = await renderHtmlToPdf(usable[0].html, { margin });
    const name = `${book}_워크북키트_${date}.pdf`;
    const encoded = encodeURIComponent(name);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="workbook-kit.pdf"; filename*=UTF-8''${encoded}`,
        ...(warnings.length ? { 'X-Workbook-Kit-Warnings': encodeURIComponent(warnings.join(' | ')) } : {}),
      },
    });
  }

  if (format === 'pdf' && usable.length > 1) {
    /* 여러 HTML → 본문만 이어 붙인 합본 */
    const bodies = usable.map((e) => {
      const m = e.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      return `<section style="page-break-after:always">${m ? m[1] : e.html}</section>`;
    });
    const styles = usable
      .map((e) => {
        const sm = e.html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        return sm ? sm[1] : '';
      })
      .join('\n');
    const merged = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${styles}</style></head><body>${bodies.join('\n')}</body></html>`;
    const pdf = await renderHtmlToPdf(merged, { margin });
    const name = `${book}_워크북키트_${date}.pdf`;
    const encoded = encodeURIComponent(name);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="workbook-kit.pdf"; filename*=UTF-8''${encoded}`,
      },
    });
  }

  const zip = await renderHtmlEntriesToZip(
    usable.map((e) => ({ fileName: e.fileName, html: e.html })),
    { margin, zipFolder: '' },
  );
  const zipName = `${book}_워크북키트_${date}.zip`;
  const encoded = encodeURIComponent(zipName);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="workbook-kit.zip"; filename*=UTF-8''${encoded}`,
      ...(warnings.length ? { 'X-Workbook-Kit-Warnings': encodeURIComponent(warnings.join(' | ')) } : {}),
    },
  });
}
