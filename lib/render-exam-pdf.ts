/**
 * 여러 HTML → PDF 일괄 렌더 (puppeteer 브라우저 1개 재사용).
 * 지문별 ZIP 다운로드처럼 한 요청에서 여러 PDF 를 만들 때 사용.
 */
export async function renderExamPdfs(htmls: string[]): Promise<Buffer[]> {
  if (htmls.length === 0) return [];
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
    executablePath,
    headless: true,
  });
  try {
    const out: Buffer[] = [];
    for (const html of htmls) {
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({ format: 'a4', printBackground: true, preferCSSPageSize: true });
        out.push(Buffer.from(pdf));
      } finally {
        await page.close().catch(() => {});
      }
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}
