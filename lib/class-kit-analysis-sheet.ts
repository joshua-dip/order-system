/**
 * 클래스키트 「종합분석지」 — 지문분석기 결과(끊어읽기·성분·구문·어법 설명·단어장·종합분석)를
 * 수업용 한 지문 한 장으로. 조판은 관리자 분석지와 같은 buildAnalysisSheetHtml 을 쓰고,
 * 표지·목차·안내·판권만 뺀다(수업 자료는 바로 본문부터).
 * 기출 지문은 원출처 지문의 분석을 쓴다(exam-origin).
 */
import { ObjectId, type Db } from 'mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { buildAnalysisSheetHtml, type SheetOptions } from '@/lib/analysis-sheet-html';
import { buildSheetPassages, type SheetPassageSource } from '@/lib/analysis-sheet-load';
import { resolveExamOrigins } from '@/lib/exam-origin';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const CLASS_KIT_SHEET_MAX = 30;

export const CLASS_KIT_SHEET_OPTIONS: Partial<SheetOptions> = {
  cover: false,
  toc: false,
  guide: false,
  colophon: false,
};

type MainState = { sentences?: unknown[] } & Record<string, unknown>;

/** 선택 순서대로 분석이 있는 지문만 모은다. allow 로 교재 권한을 거른다. */
export async function loadClassKitSheet(
  db: Db,
  ids: string[],
  allow: (textbook: string) => boolean,
): Promise<{ html: string; title: string; shown: number; skipped: number }> {
  const oids = ids.filter((id) => ObjectId.isValid(id)).slice(0, CLASS_KIT_SHEET_MAX);
  const docs = await db
    .collection('passages')
    .find({ _id: { $in: oids.map((id) => new ObjectId(id)) } })
    .project({ source_key: 1, textbook: 1, page_label: 1, page: 1 })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const origins = await resolveExamOrigins(db, oids);
  const fileFor = (id: string) => passageAnalysisFileNameForPassageId(id);
  const wanted = oids.flatMap((id) => [fileFor(id), ...(origins.get(id) ? [fileFor(origins.get(id)!.originId.toHexString())] : [])]);
  const analyses = await db
    .collection('passage_analyses')
    .find({ fileName: { $in: wanted } })
    .project({ fileName: 1, 'passageStates.main': 1 })
    .toArray();
  const mainByFile = new Map(analyses.map((a) => [String(a.fileName), (a as { passageStates?: { main?: MainState } }).passageStates?.main]));

  const sources: SheetPassageSource[] = [];
  let title = '';
  let skipped = 0;
  for (const id of oids) {
    const p = byId.get(id);
    const tb = String(p?.textbook ?? '');
    if (!p || !allow(tb)) {
      skipped += 1;
      continue;
    }
    const origin = origins.get(id);
    const main = mainByFile.get(fileFor(id)) ?? (origin ? mainByFile.get(fileFor(origin.originId.toHexString())) : undefined);
    if (!main?.sentences?.length) {
      skipped += 1;
      continue;
    }
    title ||= tb;
    sources.push({ textbook: tb, sourceKey: String(p.source_key ?? ''), pageLabel: String(p.page_label ?? p.page ?? ''), main: main as never });
  }
  const passages = buildSheetPassages(sources);
  if (passages.length === 0) return { html: '', title, shown: 0, skipped };
  const multi = new Set(sources.map((s) => s.textbook)).size > 1;
  const sheetTitle = multi ? '종합분석지' : title;
  const html = buildAnalysisSheetHtml({
    title: sheetTitle,
    subtitle: '종합분석지',
    passages,
    brand: '',
    editionLabel: '종합분석',
    options: CLASS_KIT_SHEET_OPTIONS,
    footer: `${sheetTitle} · 종합분석지`,
  });
  return { html, title: sheetTitle, shown: passages.length, skipped };
}

/** 분석지 HTML → A4 PDF (관리자 분석지 PDF 와 같은 여백·폰트 처리) */
export async function renderClassKitSheetPdf(html: string): Promise<Uint8Array<ArrayBuffer>> {
  const [{ default: chromium }, puppeteer] = await Promise.all([import('@sparticuz/chromium'), import('puppeteer-core')]);
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const local = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];
  const executablePath = isLambda ? await chromium.executablePath() : (local[0] ?? (await chromium.executablePath()));
  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic', 'Noto Sans KR'] }), {
      waitUntil: 'load',
      timeout: 120_000,
    });
    await page.evaluate(async () => {
      try {
        await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      } catch {
        /* ignore */
      }
    });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '11mm', bottom: '12mm', left: '11mm' },
      displayHeaderFooter: false,
    });
    return new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
  } finally {
    await browser.close();
  }
}

export function sheetPdfResponseHeaders(title: string, size: number): Record<string, string> {
  const name = `${title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || '종합분석지'} 종합분석지.pdf`;
  return {
    'Content-Type': 'application/pdf',
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="analysis.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  };
}
