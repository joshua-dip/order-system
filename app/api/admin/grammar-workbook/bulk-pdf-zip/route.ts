import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import { getGrammarWorkbook, GRAMMAR_MODES, type GrammarMode } from '@/lib/grammar-workbooks-store';
import { buildSingleWorkbookHtml } from '@/lib/grammar-workbook-print';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* Lambda 30s 기본 — 다건 PDF 생성 여유 */
export const maxDuration = 300;

/**
 * 선택된 워크북들을 각각 PDF 로 렌더링하고 ZIP 으로 묶어 반환.
 * 각 워크북당 1 PDF — 파일명: 워크북 title 기반.
 *
 * body: {
 *   ids: string[],
 *   modes?: ('F'|'G'|'H'|'J'|'P')[],
 *   includePoints?: boolean,
 *   layout?: 'interleaved'|'back',
 *   zipName?: string
 * }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    ids?: unknown;
    modes?: unknown;
    includePoints?: unknown;
    layout?: unknown;
    zipName?: unknown;
  };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds
    .filter((v): v is string => typeof v === 'string' && ObjectId.isValid(v))
    .slice(0, 100); // ZIP 다건 PDF: 일단 100 상한
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 가 비어있습니다.' }, { status: 400 });
  }

  const modesArr = Array.isArray(body.modes)
    ? (body.modes
        .filter((v): v is string => typeof v === 'string')
        .filter((m) => m === 'P' || (GRAMMAR_MODES as string[]).includes(m)) as (GrammarMode | 'P')[])
    : undefined;
  const includePoints = body.includePoints !== false;
  const layout = body.layout === 'back' ? 'back' : 'interleaved';
  const clientZipName = typeof body.zipName === 'string' ? body.zipName.trim() : '';

  // 1) 모든 워크북 + 각자 HTML 준비
  const built: { id: string; title: string; html: string }[] = [];
  for (const id of ids) {
    try {
      const doc = await getGrammarWorkbook(id);
      if (!doc) continue;
      const r = buildSingleWorkbookHtml(doc, { modes: modesArr, includePoints, layout });
      if (!r) continue;
      built.push({ id, title: doc.title || `어법공략_${id.slice(-6)}`, html: r.html });
    } catch (e) {
      console.error('[grammar bulk-pdf-zip] build failed', id, e);
    }
  }
  if (built.length === 0) {
    return NextResponse.json({ error: '렌더링할 워크북이 없습니다.' }, { status: 404 });
  }

  // 2) puppeteer 로 PDF 렌더링 — essay-generator/bulk-pdf-zip 와 동일 패턴
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const localChromeCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];

  const executablePath = isLambda
    ? await chromium.executablePath()
    : (localChromeCandidates[0] ?? (await chromium.executablePath()));

  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 1696, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
  });

  try {
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const w of built) {
      const page = await browser.newPage();
      try {
        await page.setContent(await prepareKoreanPdfHtml(w.html), { waitUntil: 'load', timeout: 60_000 });
        const pdfBuf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
        });
        const filename = uniqueFilename(usedNames, sanitizeFilename(w.title) + '.pdf');
        zip.file(filename, pdfBuf);
      } finally {
        await page.close();
      }
    }

    const zipBytes = (await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })) as Uint8Array;

    const sanitizedClient = clientZipName
      ? sanitizeFilename(clientZipName.replace(/\.zip$/i, ''))
      : '';
    const zipName =
      (sanitizedClient && sanitizedClient !== 'untitled'
        ? sanitizedClient
        : `어법공략_${built.length}건_${new Date().toISOString().slice(0, 10)}`) + '.zip';
    const encoded = encodeURIComponent(zipName);
    const fallback = `grammar-bulk-${Date.now()}.zip`;

    return new NextResponse(new Uint8Array(zipBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBytes.byteLength),
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser.close();
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

function uniqueFilename(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const out = `${base} (${i})${ext}`;
  used.add(out);
  return out;
}
