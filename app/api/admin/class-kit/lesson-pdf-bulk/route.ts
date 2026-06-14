import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildLessonMaterialHtml,
  buildLessonMaterialMultiPageHtml,
  clampFontScale,
  clampLineHeight,
  clampSplitPct,
  lessonModeIsLandscape,
  normalizeEnFont,
  normalizeKoFont,
  normalizeLessonMode,
  normalizeLineLayout,
  LESSON_MODE_LABELS,
  type LessonSentencePair,
} from '@/lib/lesson-material-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 다건 PDF 렌더링 — 50지문 안팎까지 안전한 5분 상한. */
export const maxDuration = 300;

/* 한 번 호출에서 처리할 최대 지문 수 — 안전장치. */
const MAX_PASSAGES = 100;

/**
 * 수업용자료 다 지문 PDF/ZIP 다운로드.
 * body: {
 *   textbook: string,                       // 교재명 (range / passageIds 와 무관하게 필요)
 *   passageIds?: string[],                  // ObjectId 배열. 미지정 시 textbook 전체.
 *   mode: 'parallel' | 'lineByLine' | 'writeEn' | 'writeKo',
 *   format: 'pdf' | 'zip',                  // pdf=단일 다 페이지, zip=지문별 PDF 묶음
 *   kicker?, lineHeight?, splitPct?, lineLayout?, enFont?, koFont?, enFontScale?, koFontScale?
 * }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  if (!textbook) {
    return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
  }
  const mode = normalizeLessonMode(body.mode);
  const format: 'pdf' | 'zip' = body.format === 'zip' ? 'zip' : 'pdf';
  const lineHeight = clampLineHeight(body.lineHeight);
  const splitPct = clampSplitPct(body.splitPct);
  const lineLayout = normalizeLineLayout(body.lineLayout);
  const enFont = normalizeEnFont(body.enFont);
  const koFont = normalizeKoFont(body.koFont);
  const enFontScale =
    body.enFontScale !== undefined ? clampFontScale(body.enFontScale) : undefined;
  const koFontScale =
    body.koFontScale !== undefined ? clampFontScale(body.koFontScale) : undefined;
  const kicker =
    typeof body.kicker === 'string' && body.kicker.trim()
      ? body.kicker.trim()
      : LESSON_MODE_LABELS[mode];

  // 1) 대상 지문 docs 조회
  const passageIdsRaw = Array.isArray(body.passageIds) ? body.passageIds : null;
  const passageIds = passageIdsRaw
    ?.filter((v): v is string => typeof v === 'string' && ObjectId.isValid(v))
    .slice(0, MAX_PASSAGES);

  const db = await getDb('gomijoshua');
  const filter: Record<string, unknown> = { textbook };
  if (passageIds && passageIds.length > 0) {
    filter._id = { $in: passageIds.map((s) => new ObjectId(s)) };
  }
  const docs = await db
    .collection('passages')
    .find(filter)
    .sort({ chapter: 1, order: 1, number: 1 })
    .limit(MAX_PASSAGES)
    .toArray();

  if (docs.length === 0) {
    return NextResponse.json({ error: '대상 지문이 없습니다.' }, { status: 404 });
  }

  type Built = { number: string; sentences: LessonSentencePair[] };
  const built: Built[] = [];
  for (const d of docs) {
    const doc = d as Record<string, unknown>;
    const content = (doc.content as Parameters<typeof tokenizePassageFromContent>[0]) ?? undefined;
    if (!content) continue;
    const toks = tokenizePassageFromContent(content);
    const koArr = Array.isArray((content as { sentences_ko?: unknown }).sentences_ko)
      ? ((content as { sentences_ko: unknown[] }).sentences_ko.map((v) => String(v ?? '').trim()))
      : [];
    const sentences: LessonSentencePair[] = toks
      .map((t, i) => ({ idx: i, en: String(t.text ?? '').trim(), ko: koArr[i] ?? '' }))
      .filter((s) => s.en);
    if (sentences.length === 0) continue;
    const rawNumber = String(doc.number ?? '');
    built.push({ number: deriveNumber(rawNumber) || rawNumber, sentences });
  }
  if (built.length === 0) {
    return NextResponse.json({ error: '본문이 있는 지문이 없습니다.' }, { status: 404 });
  }

  // 2) puppeteer
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

  const landscape = lessonModeIsLandscape(mode);
  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: landscape
      ? { width: 1123, height: 794, deviceScaleFactor: 2 }
      : { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });

  try {
    const dateSlug = new Date().toISOString().slice(0, 10);
    const modeLabel = LESSON_MODE_LABELS[mode];
    const baseName = `수업용자료_${modeLabel}_${sanitizeFilename(textbook)}`;

    if (format === 'zip') {
      const zip = new JSZip();
      const used = new Set<string>();
      let idx = 0;
      for (const w of built) {
        idx += 1;
        const html = buildLessonMaterialHtml({
          kicker,
          title: textbook,
          number: w.number,
          sentences: w.sentences,
          mode,
          lineHeight,
          splitPct,
          lineLayout,
          enFont,
          koFont,
          enFontScale,
          koFontScale,
        });
        const page = await browser.newPage();
        try {
          await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }),{ waitUntil: 'load', timeout: 60_000 });
          await page.evaluate(async () => {
            try {
              await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
            } catch {
              /* ignore */
            }
          });
          const pdfBuf = await page.pdf({
            format: 'A4',
            landscape,
            printBackground: true,
            margin: landscape
              ? { top: '0', right: '0', bottom: '0', left: '0' }
              : { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
            ...(landscape ? { pageRanges: '1' } : {}),
          });
          const numLabel = sanitizeFilename(w.number || String(idx));
          const filename = uniqueFilename(used, `${numLabel}.pdf`);
          zip.file(filename, pdfBuf);
        } finally {
          await page.close();
        }
      }
      const zipBytes = (await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })) as Uint8Array;
      const zipName = `${baseName}_${dateSlug}.zip`;
      const encoded = encodeURIComponent(zipName);
      const fallback = `lesson-bulk-${Date.now()}.zip`;
      return new NextResponse(new Uint8Array(zipBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipBytes.byteLength),
          'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // format === 'pdf' — 다 페이지 단일 PDF
    const html = buildLessonMaterialMultiPageHtml({
      kicker,
      mode,
      items: built.map((b) => ({ title: textbook, number: b.number, sentences: b.sentences })),
      lineHeight,
      splitPct,
      lineLayout,
      enFont,
      koFont,
      enFontScale,
      koFontScale,
    });
    const page = await browser.newPage();
    try {
      await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }),{ waitUntil: 'load', timeout: 120_000 });
      await page.evaluate(async () => {
        try {
          await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        } catch {
          /* ignore */
        }
      });
      const pdfBuf = await page.pdf({
        format: 'A4',
        landscape,
        printBackground: true,
        margin: landscape
          ? { top: '0', right: '0', bottom: '0', left: '0' }
          : { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
      });
      const fileName = `${baseName}_${dateSlug}.pdf`;
      const encoded = encodeURIComponent(fileName);
      const bytes = new Uint8Array(pdfBuf);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `attachment; filename="lesson-bulk.pdf"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

function uniqueFilename(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const out = `${base} (${i})${ext}`;
  used.add(out);
  return out;
}
