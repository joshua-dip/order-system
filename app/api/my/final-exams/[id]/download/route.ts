import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  ensureGradeToken,
  getFinalExamJob,
  loadExamQuestions,
  refillJobShortages,
} from '@/lib/final-exam-store';
import {
  buildFinalExamSheetHtml,
  buildFinalExamAnswerHtml,
} from '@/lib/final-exam-html';
import { publicBaseUrl } from '@/lib/public-base-url';
import { getEmbeddedKoreanFontFaceCss } from '@/lib/pdf-korean-font';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const kind = request.nextUrl.searchParams.get('kind') === 'answer' ? 'answer' : 'exam';

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

    const questions = await loadExamQuestions(db, job);
    if (questions.length === 0) {
      return NextResponse.json({ error: '문항을 불러오지 못했습니다.' }, { status: 500 });
    }

    const subtitle = `${job.scopeSummary} · 총 ${questions.length}문항`;
    /* Lambda Chromium 은 한글 시스템 폰트가 없으므로 NanumGothic 을 @font-face 로 임베드 */
    const fontFaceCss = await getEmbeddedKoreanFontFaceCss();
    let html: string;
    if (kind === 'answer') {
      html = buildFinalExamAnswerHtml({ title: job.title, subtitle, questions, fontFaceCss });
    } else {
      /* QR 채점 — 문제지 헤더에 채점 페이지 QR 인쇄 */
      const token = await ensureGradeToken(db, job);
      const gradeUrl = `${publicBaseUrl(request)}/grade/${token}`;
      let qrDataUrl: string | undefined;
      try {
        const QRCode = (await import('qrcode')).default;
        qrDataUrl = await QRCode.toDataURL(gradeUrl, { margin: 0, width: 240 });
      } catch (e) {
        console.error('[final-exams download] QR 생성 실패:', e);
      }
      html = buildFinalExamSheetHtml({
        title: job.title,
        subtitle,
        questions,
        qrDataUrl,
        qrLabel: 'QR 스캔 → 바로 채점',
        fontFaceCss,
      });
    }

    const pdf = await renderPdf(html);
    const stamp = (job.createdAt instanceof Date ? job.createdAt : new Date())
      .toISOString().slice(0, 10).replace(/-/g, '');
    const fname = sanitizeFilename(
      `파이널예비모의고사_${stamp}_${kind === 'answer' ? '정답해설' : '문제지'}.pdf`,
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
