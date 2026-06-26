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

type PuppeteerMod = typeof import('puppeteer-core');
type ChromiumMod = typeof import('@sparticuz/chromium').default;
type Browser = Awaited<ReturnType<PuppeteerMod['default']['launch']>>;

/** 한 HTML 렌더 사이 브라우저를 재기동할 주기(메모리 누수로 인한 중간 크래시 방지). */
const RECYCLE_EVERY = 16;
const PAGE_TIMEOUT_MS = 90_000;

async function launchBrowser(chromium: ChromiumMod, puppeteer: PuppeteerMod): Promise<Browser> {
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
    executablePath,
    headless: true,
  });
}

/** HTML 한 장 → PDF (페이지 단발 렌더). 실패 시 호출부에서 재시도. */
async function renderOne(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    const pdf = await page.pdf({ format: 'a4', printBackground: true, preferCSSPageSize: true, timeout: PAGE_TIMEOUT_MS });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 여러 HTML → PDF 일괄 렌더 (puppeteer 브라우저 1개 재사용).
 * 지문별·학생별 ZIP 처럼 한 요청에서 여러 PDF 를 만들 때 사용.
 *
 * 견고성: 한 장이 실패해도 전체가 죽지 않도록 항목별 최대 3회 재시도하고,
 *  - 브라우저가 끊겼으면 재기동 후 재시도,
 *  - {@link RECYCLE_EVERY} 장마다 브라우저를 재기동해 메모리 누수로 인한 중간 크래시를 막는다.
 * 최종 실패 시 어느 항목인지 메시지에 담아 throw 한다.
 */
export async function renderExamPdfs(htmls: string[]): Promise<Buffer[]> {
  if (htmls.length === 0) return [];
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  let browser = await launchBrowser(chromium, puppeteer);
  let sinceRecycle = 0;
  const out: Buffer[] = new Array(htmls.length);
  try {
    for (let i = 0; i < htmls.length; i++) {
      // 일정 수마다 브라우저 재기동 — 메모리 바운드
      if (sinceRecycle >= RECYCLE_EVERY) {
        await browser.close().catch(() => {});
        browser = await launchBrowser(chromium, puppeteer);
        sinceRecycle = 0;
      }
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!browser.connected) {
            browser = await launchBrowser(chromium, puppeteer);
            sinceRecycle = 0;
          }
          out[i] = await renderOne(browser, htmls[i]);
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
          // 브라우저가 죽었으면 다음 시도 전에 재기동
          if (!browser.connected) {
            try {
              browser = await launchBrowser(chromium, puppeteer);
              sinceRecycle = 0;
            } catch { /* 다음 시도에서 재시도 */ }
          }
        }
      }
      if (lastErr !== undefined) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        throw new Error(`PDF 렌더 실패 (${i + 1}/${htmls.length}): ${msg}`);
      }
      sinceRecycle++;
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}
