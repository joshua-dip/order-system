/**
 * PDF 버퍼의 페이지 수 — 페이지 객체(`/Type /Page`, `/Pages` 제외) 개수.
 * 합본 시 학생별 페이지 수로 홀수페이지 정렬(빈 페이지 삽입)을 계산하는 데 쓴다.
 */
export function countPdfPages(pdf: Buffer): number {
  const s = pdf.toString('latin1');
  const pages = s.match(/\/Type\s*\/Page(?!s)/g);
  if (pages && pages.length > 0) return pages.length;
  // 폴백: 페이지 트리 루트의 /Count
  const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10)).filter((n) => n > 0);
  return counts.length ? Math.max(...counts) : 1;
}

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
