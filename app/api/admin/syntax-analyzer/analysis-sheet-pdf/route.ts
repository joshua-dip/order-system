import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { buildAnalysisPrintHtml, type AnalysisPrintPassage } from '@/lib/analysis-print-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 지문 분석지 PDF — 분석기(passage_analyses)에 저장된 데이터를 그대로 묶어 낸다.
 *
 * 항상 저장소를 다시 읽으므로, 분석 작업대에서 고친 내용이 다음 다운로드에 바로
 * 반영된다(스냅샷을 두지 않는 것이 의도). body: { passageIds, title?, brand? }
 */

/* Lambda 60초 안에서 안전한 상한. Lesson 2 기준 7지문 = 18쪽·약 8초였다. */
const MAX_PASSAGES = 30;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { passageIds?: unknown; title?: unknown; brand?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const ids = (Array.isArray(body.passageIds) ? body.passageIds : [])
    .map((x) => String(x ?? '').trim())
    .filter((id) => ObjectId.isValid(id));
  if (ids.length === 0) {
    return NextResponse.json({ error: '지문을 선택해 주세요.' }, { status: 400 });
  }
  if (ids.length > MAX_PASSAGES) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_PASSAGES}개까지만 묶을 수 있습니다. 나눠서 받아 주세요.` },
      { status: 400 },
    );
  }

  const db = await getDb('gomijoshua');
  const passageDocs = await db
    .collection('passages')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .project({ source_key: 1, textbook: 1 })
    .toArray();
  const byId = new Map(passageDocs.map((d) => [String(d._id), d]));

  const analyses = await db
    .collection('passage_analyses')
    .find({ fileName: { $in: ids.map((id) => passageAnalysisFileNameForPassageId(id)) } })
    .project({ fileName: 1, 'passageStates.main': 1 })
    .toArray();
  const mainByPid = new Map(
    analyses.map((d) => {
      const m = /^passage:([a-f0-9]{24})$/i.exec(String((d as { fileName?: string }).fileName ?? ''));
      return [m ? m[1].toLowerCase() : '', (d as Record<string, any>).passageStates?.main] as const;
    }),
  );

  /* 선택한 순서 그대로 묶는다 — 화면에서 고른 차례가 곧 지면 차례. */
  const passages: AnalysisPrintPassage[] = [];
  const skipped: string[] = [];
  let textbook = '';
  for (const id of ids) {
    const p = byId.get(id);
    const m = mainByPid.get(id.toLowerCase());
    const label = String(p?.source_key ?? id);
    if (!p || !m?.sentences?.length) {
      skipped.push(label);
      continue;
    }
    textbook = String(p.textbook ?? textbook);
    passages.push({
      label,
      sentences: m.sentences,
      koreanSentences: m.koreanSentences ?? [],
      comprehensive: m.analysisResults?.comprehensive ?? {},
      topicSentences: m.topicHighlightedSentences ?? [],
      essaySentences: m.essayHighlightedSentences ?? [],
      sentenceBreaks: m.sentenceBreaks ?? {},
      grammarPoints: m.grammarPointsBySentence ?? {},
      vocabulary: (m.vocabularyList ?? []).map((v: Record<string, unknown>) => ({
        word: String(v.word ?? ''),
        meaning: String(v.meaning ?? ''),
        partOfSpeech: v.partOfSpeech as string | undefined,
        cefr: v.cefr as string | undefined,
        synonym: (v.synonym ?? v.antonym) as string | undefined,
      })),
    });
  }
  if (passages.length === 0) {
    return NextResponse.json(
      { error: '선택한 지문에 저장된 분석이 없습니다. 분석 작업대에서 먼저 채워 주세요.' },
      { status: 400 },
    );
  }

  const title =
    (typeof body.title === 'string' && body.title.trim().slice(0, 120)) ||
    `${textbook} 지문 분석지`;
  const brand = typeof body.brand === 'string' ? body.brand.trim().slice(0, 60) : '';

  const html = buildAnalysisPrintHtml({
    title,
    subtitle: `${textbook} · 지문 ${passages.length}개${skipped.length ? ` (분석 없는 ${skipped.length}개 제외)` : ''}`,
    brand,
    passages,
  });

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
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(await prepareKoreanPdfHtml(html), { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    const filename = `${sanitizeFilename(`분석지_${title}`)}.pdf`;
    const bytes = new Uint8Array(pdfBuf);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="analysis.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
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
