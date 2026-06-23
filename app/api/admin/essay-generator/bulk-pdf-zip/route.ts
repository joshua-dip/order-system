import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import {
  renderEssayGroupsToPdfs,
  sanitizeFilename,
  uniqueFilename,
} from '@/lib/essay-pdf-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* Lambda 30s 기본 — 100건 PDF 생성도 보통 안 넘지만 여유 두기. */
export const maxDuration = 300;

/**
 * 선택 항목들을 그룹별 PDF로 분할 생성하고 ZIP 으로 묶어 반환.
 *
 * Body JSON:
 *   {
 *     groups: [
 *       { name: '18번', ids: ['<oid>', '<oid>', ...] },
 *       { name: '19번', ids: [...] },
 *       ...
 *     ]
 *   }
 *
 * 각 그룹은 합본 HTML 을 만들어 puppeteer 로 PDF 렌더링. ZIP 안 파일명은 `{name}.pdf`
 * (그룹이 분할되면 `{name} (1-2).pdf` 처럼). 렌더 로직은 lib/essay-pdf-render 공유.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { groups?: Array<{ name?: string; ids?: string[] }>; zipName?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const clientZipName = typeof body.zipName === 'string' ? body.zipName.trim() : '';

  const groups = (body.groups ?? []).filter(
    (g): g is { name: string; ids: string[] } =>
      typeof g?.name === 'string' && g.name.trim() !== '' && Array.isArray(g?.ids) && g.ids.length > 0,
  );
  if (groups.length === 0) {
    return NextResponse.json({ error: 'groups 가 비어있습니다.' }, { status: 400 });
  }

  const rendered = await renderEssayGroupsToPdfs(groups);

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const group of rendered) {
    const total = group.pdfs.length;
    group.pdfs.forEach((pdfBuf, ci) => {
      const base = sanitizeFilename(group.name);
      const labeled = total > 1 ? `${base} (${ci + 1}-${total})` : base;
      const filename = uniqueFilename(usedNames, labeled + '.pdf');
      zip.file(filename, pdfBuf);
    });
  }

  const zipBytes = (await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })) as Uint8Array;

  /* 파일명: 클라이언트가 보낸 zipName (교재명 기반) 을 우선. 없거나 sanitize 후 비면 fallback. */
  const sanitizedClient = clientZipName
    ? sanitizeFilename(clientZipName.replace(/\.zip$/i, ''))
    : '';
  const zipName = (sanitizedClient && sanitizedClient !== 'untitled' ? sanitizedClient : `서술형_${rendered.length}그룹_${new Date().toISOString().slice(0, 10)}`) + '.zip';
  const encoded = encodeURIComponent(zipName);
  const fallback = `essay-bulk-${Date.now()}.zip`;

  return new NextResponse(new Uint8Array(zipBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(zipBytes.byteLength),
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store',
    },
  });
}
