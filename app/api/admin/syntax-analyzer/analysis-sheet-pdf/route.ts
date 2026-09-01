import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import {
  buildAnalysisSheetHtml,
  QUESTION_EDITION_OPTIONS,
  type SheetOptions,
} from '@/lib/analysis-sheet-html';
import { buildSheetPassages, type SheetPassageSource } from '@/lib/analysis-sheet-load';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 리치 조판은 25지문에 수 분까지 간다(7월 실측 3MB). 리체움과 같은 120초. */
export const maxDuration = 120;

/**
 * 지문 분석지 PDF — 2026-07-29 수능특강 분석지와 같은 조판(리체움 이식본).
 *
 * 항상 저장소를 다시 읽으므로, 분석 작업대에서 고친 내용이 다음 다운로드에 바로
 * 반영된다(스냅샷을 두지 않는 것이 의도).
 * body: { passageIds, title?, brand?, edition?: '해설편'|'문제편' }
 */

const MAX_PASSAGES = 30;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
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
  const edition = body.edition === '문제편' ? '문제편' : body.edition === '분석지' ? '분석지' : '해설편';
  /* 화면 양식 패널에서 조합한 옵션이 오면 그것을 쓴다. 없으면 판 기본 프리셋. */
  const customOptions = body.options && typeof body.options === 'object'
    ? (body.options as Partial<SheetOptions>)
    : null;

  const db = await getDb('gomijoshua');
  const passageDocs = await db
    .collection('passages')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .project({ source_key: 1, textbook: 1, page_label: 1, page: 1 })
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
  const sources: SheetPassageSource[] = [];
  let textbook = '';
  for (const id of ids) {
    const p = byId.get(id);
    const main = mainByPid.get(id.toLowerCase());
    if (!p || !main?.sentences?.length) continue;
    textbook = String(p.textbook ?? textbook);
    sources.push({
      textbook,
      sourceKey: String(p.source_key ?? ''),
      pageLabel: String(p.page_label ?? p.page ?? ''),
      main,
    });
  }
  const passages = buildSheetPassages(sources);
  if (passages.length === 0) {
    return NextResponse.json(
      { error: '선택한 지문에 저장된 분석이 없습니다. 분석 작업대에서 먼저 채워 주세요.' },
      { status: 400 },
    );
  }

  const title =
    (typeof body.title === 'string' && body.title.trim().slice(0, 120)) || textbook;
  const brand = typeof body.brand === 'string' ? body.brand.trim().slice(0, 60) : '';
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = buildAnalysisSheetHtml({
    title,
    subtitle: '지문 분석지',
    passages,
    brand,
    date,
    editionLabel: edition,
    options: customOptions ?? (edition === '문제편' ? QUESTION_EDITION_OPTIONS : {}),
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
    await page.setContent(
      await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic', 'Noto Sans KR'] }),
      { waitUntil: 'load', timeout: 120_000 },
    );
    await page.evaluate(async () => {
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    });
    /* 여백·꼬리말은 7월 실물과 동일 — 꼬리말에 「제목 · 판」과 쪽번호. */
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '11mm', bottom: '12mm', left: '11mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 12mm;display:flex;justify-content:space-between">
        <span>${title} · ${edition}</span><span class="pageNumber"></span></div>`,
    });

    /* 판 이름이 그냥 '분석지'(커스텀 양식)면 「분석지 · 분석지」로 겹치지 않게. */
    const filename = `${sanitizeFilename(edition === '분석지' ? `${title} 분석지` : `${title} 분석지 · ${edition}`)}.pdf`;
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
