import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { buildLectureMaterialHtml, clampLineHeight, type LectureSentence } from '@/lib/lecture-material-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 단건 PDF — puppeteer 렌더 여유 */
export const maxDuration = 60;

/**
 * 강의용자료 단건을 A4 한 페이지 PDF 로 렌더링.
 * body: { kicker?, title?, number?, lineHeight?, sentences: string[] }
 * (구조 파라미터를 받아 서버에서 HTML 을 재구성 — 임의 HTML 신뢰 안 함.)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { kicker?: unknown; title?: unknown; number?: unknown; lineHeight?: unknown; sentences?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const rawSentences = Array.isArray(body.sentences) ? body.sentences : [];
  const sentences: LectureSentence[] = rawSentences
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .map((text, idx) => ({ idx, text }));
  if (sentences.length === 0) {
    return NextResponse.json({ error: '지문 문장이 없습니다.' }, { status: 400 });
  }

  const kicker = typeof body.kicker === 'string' ? body.kicker : undefined;
  const title = typeof body.title === 'string' ? body.title : undefined;
  const number = typeof body.number === 'string' ? body.number : undefined;
  const lineHeight = clampLineHeight(body.lineHeight);

  const html = buildLectureMaterialHtml({ kicker, title, number, sentences, lineHeight });

  // puppeteer 로 PDF 렌더링 — grammar/essay bulk-pdf-zip 와 동일 패턴
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

  // A4 픽셀(96dpi) 뷰포트 — auto-fit 스크립트가 한 페이지에 맞춰 글자 크기를 줄임
  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }),{ waitUntil: 'load', timeout: 60_000 });
    // 폰트(@import Pretendard) 로드 보장
    await page.evaluate(async () => {
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges: '1', // 한 화면 = 한 페이지 보장
    });

    const body2 = sanitizeFilename([title, number].filter(Boolean).join('_'));
    const filename = body2 ? `강의용자료_${body2}.pdf` : '강의용자료.pdf';
    const encoded = encodeURIComponent(filename);
    const bytes = new Uint8Array(pdfBuf);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="lecture.pdf"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser.close();
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
}
