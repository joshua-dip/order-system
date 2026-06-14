import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import { getEssayExam } from '@/lib/essay-exams-store';
import { readExamCss } from '@/lib/essay-exam-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* Lambda 30s 기본 — 100건 PDF 생성도 보통 안 넘지만 여유 두기. */
export const maxDuration = 300;

/**
 * 선택 항목들을 그룹별 PDF로 분할 생성하고 ZIP 으로 묶어 반환.
 *
 * Body JSON:
 *   {
 *     groups: [
 *       { name: '18번', ids: ['<oid>', '<oid>', ...] },
 *       { name: '19번', ids: [...] },
 *       ...
 *     ]
 *   }
 *
 * 각 그룹은 listExamsByFolder 의 폴더 출력과 동일한 합본 HTML 을 만들어
 * puppeteer 로 PDF 렌더링. ZIP 안 파일명은 `{name}.pdf`.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { groups?: Array<{ name?: string; ids?: string[] }>; zipName?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const clientZipName = typeof body.zipName === 'string' ? body.zipName.trim() : '';

  const groups = (body.groups ?? []).filter(
    (g): g is { name: string; ids: string[] } =>
      typeof g?.name === 'string' && g.name.trim() !== '' && Array.isArray(g?.ids) && g.ids.length > 0,
  );
  if (groups.length === 0) {
    return NextResponse.json({ error: 'groups 가 비어있습니다.' }, { status: 400 });
  }

  /* 모든 ID 한 번에 가져오기 → 그룹별로 다시 매핑. 같은 ID 가 여러 그룹에 있어도 1회 fetch. */
  const allIds = Array.from(new Set(groups.flatMap(g => g.ids).filter(id => ObjectId.isValid(id))));
  const examMap = new Map<string, Awaited<ReturnType<typeof getEssayExam>>>();
  await Promise.all(
    allIds.map(async (id) => {
      const e = await getEssayExam(id);
      examMap.set(id, e);
    }),
  );

  const css = readExamCss();

  /* puppeteer 동적 import — 빌드 시 모듈 평가 회피 (서버 전용). */
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
    defaultViewport: { width: 1280, height: 1696, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
  });

  try {
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const group of groups) {
      const exams = group.ids
        .map(id => examMap.get(id))
        .filter(
          (e): e is NonNullable<typeof e> =>
            e != null && !e.isPlaceholder && typeof e.html === 'string' && e.html.length > 0,
        );
      if (exams.length === 0) continue;

      const html = await prepareKoreanPdfHtml(buildCombinedHtml(exams.map(e => String(e.html)), css));

      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
        const pdfBuf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
        });
        const filename = uniqueFilename(usedNames, sanitizeFilename(group.name) + '.pdf');
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

    /* 파일명: 클라이언트가 보낸 zipName (교재명 기반) 을 우선. 없거나 sanitize 후 비면 fallback. */
    const sanitizedClient = clientZipName
      ? sanitizeFilename(clientZipName.replace(/\.zip$/i, ''))
      : '';
    const zipName = (sanitizedClient && sanitizedClient !== 'untitled' ? sanitizedClient : `서술형_${groups.length}그룹_${new Date().toISOString().slice(0, 10)}`) + '.zip';
    const encoded = encodeURIComponent(zipName);
    const fallback = `essay-bulk-${Date.now()}.zip`;

    return new NextResponse(new Uint8Array(zipBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zipBytes.byteLength),
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    await browser.close();
  }
}

function buildCombinedHtml(htmls: string[], css: string): string {
  const parts = htmls.map(splitHtml);
  const sheetSections = parts.map(p => p.sheet);
  const answerSections = parts
    .map((p, i) => (p.answer ? (i === 0 ? '' : '<div class="page-break"></div>') + p.answer : null))
    .filter((s): s is string => !!s);
  const sheetsHtml = sheetSections.join('\n<div class="page-break"></div>\n');
  const answersHtml = answerSections.join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
${css}
.page-break { page-break-before: always; }
</style>
</head>
<body>
${sheetsHtml}
${answersHtml ? '<div class="page-break"></div>\n' + answersHtml : ''}
</body>
</html>`;
}

function splitHtml(html: string): { sheet: string; answer: string } {
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : html;
  const BREAK = '<div class="page-break"></div>';
  const breakIdx = body.indexOf(BREAK);
  if (breakIdx === -1) return { sheet: body.trim(), answer: '' };
  return {
    sheet: body.slice(0, breakIdx).trim(),
    answer: body.slice(breakIdx + BREAK.length).trim(),
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

function uniqueFilename(used: Set<string>, name: string): string {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const out = `${base} (${i})${ext}`;
  used.add(out);
  return out;
}
