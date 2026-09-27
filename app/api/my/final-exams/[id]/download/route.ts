import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import { getFinalExamJob, refillJobShortages } from '@/lib/final-exam-store';
import {
  applyFinalExamOrder,
  buildFinalExamHtmlForJob,
  parseFinalExamOrder,
  waitForPaperFonts,
} from '@/lib/final-exam-render';
import { publicBaseUrl } from '@/lib/public-base-url';
import { getEmbeddedKoreanFontFaceCss } from '@/lib/pdf-korean-font';

import { withDownloadTracking } from '@/lib/site-usage-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* puppeteer 다중 페이지 렌더 여유 */
export const maxDuration = 120;

async function renderPdf(html: string): Promise<Buffer> {
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
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await waitForPaperFonts(page);
    const pdf = await page.pdf({
      format: 'a4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'final-exam';
}

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const kind = sp.get('kind') === 'answer' ? 'answer' : 'exam';
  const order = parseFinalExamOrder(sp.get('order'));
  const reshuffle = sp.get('reshuffle') === '1';
  /** 지문(출처)별 다운로드 — 해당 sourceKey 문항만 1번부터 재번호. 빈값이면 전체. */
  const sourceParam = (sp.get('source') || '').trim();

  try {
    const db = await getDb('gomijoshua');
    const me = await db
      .collection('users')
      .findOne({ _id: auth.userId }, { projection: { loginId: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    let job = await getFinalExamJob(db, id, loginId);
    if (!job) return NextResponse.json({ error: '다운로드 항목을 찾을 수 없습니다.' }, { status: 404 });

    if (job.status === 'awaiting_admin') {
      job = await refillJobShortages(db, job);
    }
    if (job.status !== 'ready') {
      const short = job.totalRequested - job.totalAssigned;
      return NextResponse.json(
        {
          error: `아직 제작 중입니다. 부족 문항 ${short}개가 완성되면 다운로드할 수 있습니다.`,
          status: job.status,
        },
        { status: 409 },
      );
    }

    // 다운로드 정렬 옵션 — 잡에 저장해 문제지·정답·채점이 같은 순서를 따르게 (lib/final-exam-render)
    job = await applyFinalExamOrder(db, job, loginId, order, reshuffle);

    /* Lambda Chromium 은 한글 시스템 폰트가 없으므로 NanumGothic 을 @font-face 로 임베드 */
    const fontFaceCss = await getEmbeddedKoreanFontFaceCss();
    const built = await buildFinalExamHtmlForJob(db, job, {
      kind,
      source: sourceParam,
      baseUrl: publicBaseUrl(request),
      fontFaceCss,
    });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });
    const html = built.html;

    const pdf = await renderPdf(html);
    const stamp = (job.createdAt instanceof Date ? job.createdAt : new Date())
      .toISOString().slice(0, 10).replace(/-/g, '');
    const srcTag = sourceParam ? `_${sourceParam}` : '';
    const fname = sanitizeFilename(
      `내신예비시험지_${stamp}${srcTag}_${kind === 'answer' ? '정답해설' : '문제지'}.pdf`,
    );
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="final-exam-${stamp}-${kind}.pdf"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[final-exams download]', e);
    return NextResponse.json({ error: 'PDF 생성에 실패했습니다.' }, { status: 500 });
  }
}

export const GET = withDownloadTracking('파이널 예비 모의고사', handleGET);
