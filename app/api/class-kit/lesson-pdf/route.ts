import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/user-auth';
import {
  buildLessonMaterialHtml,
  clampLineHeight,
  clampSplitPct,
  clampFontScale,
  lessonModeIsLandscape,
  normalizeLessonMode,
  normalizeLineLayout,
  normalizeEnFont,
  normalizeKoFont,
  LESSON_MODE_LABELS,
  type LessonSentencePair,
} from '@/lib/lesson-material-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 수업용자료 단건을 A4 PDF 로 렌더링. 모드에 따라 가로(영한대조)/세로(나머지).
 * body: { kicker?, title?, number?, mode?, lineHeight?, splitPct?, sentences: { en, ko? }[] }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireUser(request);
  if (error) return error;

  let body: { kicker?: unknown; title?: unknown; number?: unknown; mode?: unknown; lineHeight?: unknown; splitPct?: unknown; lineLayout?: unknown; enFont?: unknown; koFont?: unknown; fontScale?: unknown; enFontScale?: unknown; koFontScale?: unknown; sentences?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const rawSentences = Array.isArray(body.sentences) ? body.sentences : [];
  const sentences: LessonSentencePair[] = rawSentences
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const en = String(o.en ?? '').trim();
      const ko = String(o.ko ?? '').trim();
      return { en, ko };
    })
    .filter((s) => s.en)
    .map((s, idx) => ({ idx, en: s.en, ko: s.ko }));
  if (sentences.length === 0) {
    return NextResponse.json({ error: '지문 문장이 없습니다.' }, { status: 400 });
  }

  const kicker = typeof body.kicker === 'string' ? body.kicker : undefined;
  const title = typeof body.title === 'string' ? body.title : undefined;
  const number = typeof body.number === 'string' ? body.number : undefined;
  const lineHeight = clampLineHeight(body.lineHeight);
  const splitPct = clampSplitPct(body.splitPct);
  const lineLayout = normalizeLineLayout(body.lineLayout);
  const enFont = normalizeEnFont(body.enFont);
  const koFont = normalizeKoFont(body.koFont);
  // EN/KO 배율 분리 — 둘 다 비면 fontScale(레거시) 폴백
  const enFontScale = body.enFontScale !== undefined ? clampFontScale(body.enFontScale) : undefined;
  const koFontScale = body.koFontScale !== undefined ? clampFontScale(body.koFontScale) : undefined;
  const fontScale = body.fontScale !== undefined ? clampFontScale(body.fontScale) : undefined;
  const mode = normalizeLessonMode(body.mode);
  const landscape = lessonModeIsLandscape(mode);

  const html = buildLessonMaterialHtml({ kicker, title, number, sentences, lineHeight, splitPct, lineLayout, enFont, koFont, enFontScale, koFontScale, fontScale, mode });

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

  // 모드별 뷰포트 — 가로(영한대조)는 한 화면 auto-fit, 세로(나머지)는 자연 흐름
  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: landscape
      ? { width: 1123, height: 794, deviceScaleFactor: 2 }
      : { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    });
    const pdfBuf = await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: landscape
        ? { top: '0', right: '0', bottom: '0', left: '0' }
        : { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
      // 영한대조는 한 화면 = 한 페이지, 세로 워크시트는 다중 페이지 허용
      ...(landscape ? { pageRanges: '1' } : {}),
    });

    const modeLabel = LESSON_MODE_LABELS[mode];
    const segs = [...(modeLabel !== '수업용자료' ? [modeLabel] : []), title, number].filter(Boolean).join('_');
    const part = sanitizeFilename(segs);
    const filename = part ? `수업용자료_${part}.pdf` : '수업용자료.pdf';
    const encoded = encodeURIComponent(filename);
    const bytes = new Uint8Array(pdfBuf);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="lesson.pdf"; filename*=UTF-8''${encoded}`,
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
