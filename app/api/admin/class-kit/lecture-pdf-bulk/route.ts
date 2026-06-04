import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildLectureMaterialHtml,
  buildLectureMaterialMultiPageHtml,
  clampLineHeight,
  type LectureSentence,
} from '@/lib/lecture-material-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 다건 PDF 렌더링 — Lambda 기본 30s 초과 가능 → 300s */
export const maxDuration = 300;

/**
 * 강의용자료 — 한 교재 전체를 한 번에 다운로드.
 * body: { textbook, kicker?, lineHeight?, format: 'zip' | 'pdf' }
 *   format=zip → 지문마다 A4 1장 PDF 를 zip 으로 묶음 (개별 관리/재인쇄 용이)
 *   format=pdf → 지문마다 A4 1페이지로 합친 다 페이지 PDF (강의 전 일괄 인쇄 용이)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { textbook?: unknown; kicker?: unknown; lineHeight?: unknown; format?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  if (!textbook) {
    return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
  }
  const kicker =
    typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : '강의용자료';
  const lineHeight = clampLineHeight(body.lineHeight);
  const format: 'pdf' | 'zip' = body.format === 'pdf' ? 'pdf' : 'zip';

  // 1) 교재 전체 지문 — passages 목록 API 와 동일 정렬
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook })
    .sort({ chapter: 1, order: 1, number: 1 })
    .limit(500)
    .toArray();

  type Built = { number: string; sentences: LectureSentence[] };
  const built: Built[] = [];
  for (const d of docs) {
    const doc = d as Record<string, unknown>;
    const content = (doc.content as Parameters<typeof tokenizePassageFromContent>[0]) ?? undefined;
    if (!content) continue;
    const toks = tokenizePassageFromContent(content);
    const sentences: LectureSentence[] = toks
      .map((t) => ({ idx: t.idx, text: String(t.text ?? '').trim() }))
      .filter((s) => s.text);
    if (sentences.length === 0) continue;
    const rawNumber = String(doc.number ?? '');
    built.push({ number: deriveNumber(rawNumber) || rawNumber, sentences });
  }
  if (built.length === 0) {
    return NextResponse.json({ error: '지문이 없습니다.' }, { status: 404 });
  }

  // 2) puppeteer — lecture-pdf · grammar bulk-pdf-zip 와 동일 패턴
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
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });

  try {
    const dateSlug = new Date().toISOString().slice(0, 10);
    const baseName = `강의용자료_${sanitizeFilename(textbook)}`;

    if (format === 'zip') {
      const zip = new JSZip();
      const used = new Set<string>();
      let idx = 0;
      for (const w of built) {
        idx += 1;
        const html = buildLectureMaterialHtml({
          kicker,
          title: textbook,
          number: w.number,
          sentences: w.sentences,
          lineHeight,
        });
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
          await page.evaluate(async () => {
            try {
              await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
            } catch {
              /* ignore */
            }
          });
          const pdfBuf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            pageRanges: '1',
          });
          const numLabel = sanitizeFilename(w.number || String(idx));
          const filename = uniqueFilename(used, `${numLabel}.pdf`);
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

      const zipName = `${baseName}_${dateSlug}.zip`;
      const encoded = encodeURIComponent(zipName);
      const fallback = `lecture-bulk-${Date.now()}.zip`;
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

    // format === 'pdf' — 다 페이지 단일 PDF
    const html = buildLectureMaterialMultiPageHtml({
      kicker,
      items: built.map((b) => ({
        title: textbook,
        number: b.number,
        sentences: b.sentences,
        lineHeight,
      })),
    });
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
      await page.evaluate(async () => {
        try {
          await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        } catch {
          /* ignore */
        }
      });
      const pdfBuf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      const fileName = `${baseName}_${dateSlug}.pdf`;
      const encoded = encodeURIComponent(fileName);
      const bytes = new Uint8Array(pdfBuf);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `attachment; filename="lecture-bulk.pdf"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

/** passage.number → 워터마크 숫자(없으면 원문). page.tsx 의 deriveNumber 와 동일. */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
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
