import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

/**
 * HTML 문자열 → PDF 버퍼 (puppeteer-core + @sparticuz/chromium).
 * 한글 폰트는 prepareKoreanPdfHtml 로 임베드된다. 로컬은 시스템 Chrome, Lambda 는 @sparticuz/chromium.
 * (essay-pdf-render 의 런치 로직과 동일 패턴)
 */
export async function renderHtmlToPdf(
  html: string,
  opts?: { margin?: { top: string; right: string; bottom: string; left: string } },
): Promise<Buffer> {
  const prepared = await prepareKoreanPdfHtml(html);

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
  const executablePath = isLambda ? await chromium.executablePath() : (localChromeCandidates[0] ?? (await chromium.executablePath()));

  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 1696, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
    protocolTimeout: 280_000,
  });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(prepared, { waitUntil: 'load', timeout: 90_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: opts?.margin ?? { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' },
        timeout: 0,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
