import { NextRequest, NextResponse } from 'next/server';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { buildLectureMaterialHtml, clampLineHeight, type LectureSentence } from '@/lib/lecture-material-html';
import { buildLessonMaterialHtml, lessonModeIsLandscape, normalizeLessonMode, type LessonSentencePair, type LessonMode } from '@/lib/lesson-material-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * 클래스키트 자료(강의용·수업용·한줄해석·영작하기·해석쓰기)를 A4 **PNG 이미지 배열**로 렌더
 * (교재 스튜디오 삽입용). 클라이언트 pdfjs 는 puppeteer PDF render 가 멈추므로 서버 screenshot 사용.
 * body: { type: 'lecture'|'parallel'|'lineByLine'|'writeEn'|'writeKo', title?, number?, sentences: {en, ko?}[] }
 * 응답: { ok, landscape, images: base64PngDataUrl[] } — 페이지별 1장(세로 워크시트는 여러 장).
 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const type = String(body.type ?? 'lecture');
  const title = typeof body.title === 'string' ? body.title : undefined;
  const number = typeof body.number === 'string' ? body.number : undefined;
  const rawSentences = Array.isArray(body.sentences) ? body.sentences : [];
  const pairs = rawSentences
    .map((v, idx) => {
      const o = v as { en?: unknown; ko?: unknown };
      const en = String((typeof o === 'object' && o ? o.en : v) ?? '').trim();
      const ko = String((typeof o === 'object' && o ? o.ko : '') ?? '').trim();
      return { idx, en, ko };
    })
    .filter((p) => p.en);
  if (pairs.length === 0) return NextResponse.json({ error: '지문 문장이 없습니다.' }, { status: 400 });

  let html: string;
  let landscape = false;
  if (type === 'lecture') {
    const sentences: LectureSentence[] = pairs.map((p) => ({ idx: p.idx, text: p.en }));
    html = buildLectureMaterialHtml({ title, number, sentences, lineHeight: clampLineHeight(body.lineHeight) });
  } else {
    const mode: LessonMode = normalizeLessonMode(type);
    landscape = lessonModeIsLandscape(mode);
    const sentences: LessonSentencePair[] = pairs;
    html = buildLessonMaterialHtml({ title, number, sentences, mode });
  }

  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const localChromeCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];
  const executablePath = isLambda ? await chromium.executablePath() : (localChromeCandidates[0] ?? (await chromium.executablePath()));

  const PW = landscape ? 1123 : 794; // A4 px @96dpi
  const PH = landscape ? 794 : 1123;

  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: PW, height: PH, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }), { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => { try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ } });

    // 강의용·수업용(가로)은 auto-fit 1페이지. 세로 워크시트는 내용 높이에 맞춰 페이지 수 산출.
    const singlePage = type === 'lecture' || landscape;
    const images: string[] = [];
    if (singlePage) {
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: PW, height: PH } });
      images.push(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    } else {
      const totalH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const numPages = Math.min(20, Math.max(1, Math.ceil(totalH / PH)));
      // 전체 내용이 클립 가능하도록 뷰포트를 내용 높이로 확장
      await page.setViewport({ width: PW, height: Math.min(numPages * PH, Math.ceil(totalH)) + 8, deviceScaleFactor: 2 });
      for (let i = 0; i < numPages; i++) {
        const png = await page.screenshot({ type: 'png', clip: { x: 0, y: i * PH, width: PW, height: PH } });
        images.push(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
      }
    }
    return NextResponse.json({ ok: true, landscape, images }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('classkit-image:', e);
    return NextResponse.json({ error: '이미지 생성 실패' }, { status: 500 });
  } finally {
    await browser.close();
  }
}
