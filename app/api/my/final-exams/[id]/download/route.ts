import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  ensureGradeToken,
  getFinalExamJob,
  loadExamQuestions,
  refillJobShortages,
  FINAL_EXAM_JOBS_COLLECTION,
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

/** jobId 로부터 고정 시드 — 셔플이 재진입마다 바뀌지 않도록(문제지·답지 동일 순서 보장). */
function stableSeedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return (h >>> 0) || 1;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const kind = sp.get('kind') === 'answer' ? 'answer' : 'exam';
  const orderParam = sp.get('order');
  const order = orderParam === 'interleave' || orderParam === 'shuffle' || orderParam === 'default' ? orderParam : null;
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

    // 다운로드 정렬 옵션 — 잡에 저장해 문제지·정답·채점이 같은 순서를 따르게.
    // shuffle 시드는 jobId 기반으로 고정 → 재진입·재다운로드해도 같은 순서(문제지·답지 항상 일치).
    // '다시 섞기'(reshuffle=1) 를 누를 때만 새 랜덤 시드로 교체.
    if (order) {
      const update: Record<string, unknown> = { orderMode: order, updatedAt: new Date() };
      if (order === 'shuffle') {
        if (reshuffle) {
          update.shuffleSeed = Math.floor(Math.random() * 1_000_000_000) + 1;
        } else if (typeof job.shuffleSeed !== 'number') {
          update.shuffleSeed = stableSeedFromId(String(job._id));
        }
      }
      await db.collection(FINAL_EXAM_JOBS_COLLECTION).updateOne({ _id: job._id, loginId }, { $set: update });
      job = { ...job, ...update } as typeof job;
    }

    let questions = await loadExamQuestions(db, job);
    if (questions.length === 0) {
      return NextResponse.json({ error: '문항을 불러오지 못했습니다.' }, { status: 500 });
    }

    // 지문별 다운로드 — 선택 지문만 추려 1번부터 재번호(회차 구분 제거)
    if (sourceParam) {
      const filtered = questions
        .filter((q) => q.sourceKey === sourceParam)
        .map((q, i) => ({ ...q, num: i + 1, round: undefined }));
      if (filtered.length === 0) {
        return NextResponse.json({ error: '해당 지문의 문항을 찾을 수 없습니다.' }, { status: 404 });
      }
      questions = filtered;
    }

    const subtitle = sourceParam
      ? `${sourceParam} · ${questions.length}문항`
      : `${job.scopeSummary} · 총 ${questions.length}문항`;
    /* Lambda Chromium 은 한글 시스템 폰트가 없으므로 NanumGothic 을 @font-face 로 임베드 */
    const fontFaceCss = await getEmbeddedKoreanFontFaceCss();
    let html: string;
    if (kind === 'answer') {
      html = buildFinalExamAnswerHtml({ title: job.title, subtitle, questions, fontFaceCss });
    } else {
      /* QR 채점 — 문제지 헤더에 채점 페이지 QR 인쇄. 단, 지문별 다운로드는 전체 채점과 번호가 달라 QR 생략. */
      let qrDataUrl: string | undefined;
      if (!sourceParam) {
        const token = await ensureGradeToken(db, job);
        const gradeUrl = `${publicBaseUrl(request)}/grade/${token}`;
        try {
          const QRCode = (await import('qrcode')).default;
          qrDataUrl = await QRCode.toDataURL(gradeUrl, { margin: 0, width: 240 });
        } catch (e) {
          console.error('[final-exams download] QR 생성 실패:', e);
        }
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
    const srcTag = sourceParam ? `_${sourceParam}` : '';
    const fname = sanitizeFilename(
      `파이널예비모의고사_${stamp}${srcTag}_${kind === 'answer' ? '정답해설' : '문제지'}.pdf`,
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
