import { ObjectId } from 'mongodb';
import { getEssayExam } from '@/lib/essay-exams-store';
import { readExamCss } from '@/lib/essay-exam-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

/**
 * 서술형(essay_exams) 문항들을 그룹별 PDF 로 렌더링하는 공용 모듈.
 * - bulk-pdf-zip 라우트(여러 그룹 → ZIP)와
 * - payperic 업로드 라우트(그룹별 단일 PDF → 상품) 가 공유한다.
 *
 * 폴더당 문항이 많으면 단일 합본 PDF 가 렌더 한계에 걸리므로 chunkSize 문항씩
 * 나눠 여러 PDF 로 분할한다. (payperic 상품은 그룹당 문항 수가 작아 단일 PDF.)
 */

export const DEFAULT_PDF_CHUNK_SIZE = 40;

export interface ExamGroup {
  name: string;
  ids: string[];
}

export interface RenderedGroup {
  name: string;
  /** chunkSize 초과 시 분할된 PDF 들. 보통 1개. */
  pdfs: Buffer[];
}

/**
 * 그룹들을 PDF 로 렌더. 같은 ID 가 여러 그룹에 있어도 1회 fetch.
 * 빈 그룹(유효 문항 0)은 결과에서 제외된다.
 */
export async function renderEssayGroupsToPdfs(
  groups: ExamGroup[],
  opts?: { chunkSize?: number },
): Promise<RenderedGroup[]> {
  const chunkSize = Math.max(1, opts?.chunkSize ?? DEFAULT_PDF_CHUNK_SIZE);

  const valid = groups.filter(
    (g): g is ExamGroup =>
      !!g && typeof g.name === 'string' && g.name.trim() !== '' && Array.isArray(g.ids) && g.ids.length > 0,
  );
  if (valid.length === 0) return [];

  const allIds = Array.from(new Set(valid.flatMap((g) => g.ids).filter((id) => ObjectId.isValid(id))));
  const examMap = new Map<string, Awaited<ReturnType<typeof getEssayExam>>>();
  await Promise.all(
    allIds.map(async (id) => {
      examMap.set(id, await getEssayExam(id));
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
    protocolTimeout: 280_000,
  });

  try {
    const out: RenderedGroup[] = [];

    for (const group of valid) {
      const exams = group.ids
        .map((id) => examMap.get(id))
        .filter(
          (e): e is NonNullable<typeof e> =>
            e != null && !e.isPlaceholder && typeof e.html === 'string' && e.html.length > 0,
        );
      if (exams.length === 0) continue;

      const chunks: (typeof exams)[] = [];
      for (let i = 0; i < exams.length; i += chunkSize) {
        chunks.push(exams.slice(i, i + chunkSize));
      }

      const pdfs: Buffer[] = [];
      for (const chunk of chunks) {
        const html = await prepareKoreanPdfHtml(buildCombinedHtml(chunk.map((e) => String(e.html)), css));
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: 90_000 });
          const pdfBuf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
            timeout: 0,
          });
          pdfs.push(Buffer.from(pdfBuf));
        } finally {
          await page.close();
        }
      }
      out.push({ name: group.name, pdfs });
    }

    return out;
  } finally {
    await browser.close();
  }
}

export function buildCombinedHtml(htmls: string[], css: string): string {
  const parts = htmls.map(splitHtml);
  const sheetSections = parts.map((p) => p.sheet);
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

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

export function uniqueFilename(used: Set<string>, name: string): string {
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
