import JSZip from 'jszip';
import type { Browser } from 'puppeteer-core';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

type PdfMargin = { top: string; right: string; bottom: string; left: string };

async function launchPdfBrowser(): Promise<Browser> {
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

  return puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 1696, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
    protocolTimeout: 280_000,
  });
}

async function htmlToPdfOnBrowser(
  browser: Browser,
  html: string,
  margin: PdfMargin,
): Promise<Buffer> {
  const prepared = await prepareKoreanPdfHtml(html);
  const page = await browser.newPage();
  try {
    await page.setContent(prepared, { waitUntil: 'load', timeout: 90_000 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin,
      timeout: 0,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/**
 * HTML 문자열 → PDF 버퍼 (puppeteer-core + @sparticuz/chromium).
 * 한글 폰트는 prepareKoreanPdfHtml 로 임베드된다. 로컬은 시스템 Chrome, Lambda 는 @sparticuz/chromium.
 * (essay-pdf-render 의 런치 로직과 동일 패턴)
 */
export async function renderHtmlToPdf(
  html: string,
  opts?: { margin?: PdfMargin },
): Promise<Buffer> {
  const margin = opts?.margin ?? { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' };
  const browser = await launchPdfBrowser();
  try {
    return await htmlToPdfOnBrowser(browser, html, margin);
  } finally {
    await browser.close();
  }
}

/**
 * 여러 HTML → 각 PDF → ZIP. 브라우저는 한 번만 띄운다.
 * `variant-print-html` 처럼 `@page{margin:0}` 인 양식은 margin 을 0 으로 넘긴다.
 */
export async function renderHtmlEntriesToZip(
  entries: { fileName: string; html: string }[],
  opts?: { margin?: PdfMargin; zipFolder?: string },
): Promise<Buffer> {
  if (entries.length === 0) {
    throw new Error('렌더링할 HTML이 없습니다.');
  }
  const margin = opts?.margin ?? { top: '0', right: '0', bottom: '0', left: '0' };
  const folder = (opts?.zipFolder ?? '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  const browser = await launchPdfBrowser();
  try {
    const zip = new JSZip();
    const used = new Set<string>();
    for (const entry of entries) {
      /* 하위 폴더(카테고리별/…)는 유지하고, 파일명 금지 문자만 치환한다 */
      const parts = entry.fileName.normalize('NFC').split('/').filter(Boolean);
      const leafRaw = (parts.pop() ?? 'file').replace(/[\\/:*?"<>|]+/g, '_');
      const dirs = parts.map((p) => p.replace(/[\\/:*?"<>|]+/g, '_'));
      const leaf = leafRaw.toLowerCase().endsWith('.pdf') ? leafRaw : `${leafRaw}.pdf`;
      let name = [...dirs, leaf].join('/');
      let n = 2;
      while (used.has(name.toLowerCase())) {
        const stem = leaf.replace(/\.pdf$/i, '');
        name = [...dirs, `${stem}_${n}.pdf`].join('/');
        n += 1;
      }
      used.add(name.toLowerCase());
      const pdf = await htmlToPdfOnBrowser(browser, entry.html, margin);
      const pathInZip = folder ? `${folder}/${name}` : name;
      zip.file(pathInZip, pdf, { createFolders: true });
    }
    return Buffer.from(
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    );
  } finally {
    await browser.close();
  }
}
