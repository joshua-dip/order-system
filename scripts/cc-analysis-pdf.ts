/**
 * 분석지 PDF 뽑기 (CLI) — 웹 「지문 분석지」 메뉴와 같은 조판(리체움 이식본).
 *
 * 사용: npm run cc:analysis-pdf -- "<지정>" "<제목>" "<출력경로.pdf>" [문제편|해설편|둘다]
 *   <지정> = "<교재명>::<source_key 정규식>" 또는 정규식만.
 *   ⚠ 정규식만 쓰면 교재를 안 가린다 — "01강 01번" 같은 키는 여러 교재에 있어
 *   엉뚱한 지문이 섞인다(실제로 수능특강을 뽑는데 지금필수가 섞였다). 교재명을 붙일 것.
 *   판을 안 주면 해설편. "둘다"면 출력경로의 .pdf 앞에 " · 문제편"/" · 해설편"을 붙여 두 벌.
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import {
  buildAnalysisSheetHtml,
  QUESTION_EDITION_OPTIONS,
} from '@/lib/analysis-sheet-html';
import { buildSheetPassages, type SheetPassageSource } from '@/lib/analysis-sheet-load';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

async function main() {
  const [pattern, title, outPath, editionArg] = process.argv.slice(2);
  if (!pattern || !title || !outPath) {
    console.error('사용: cc:analysis-pdf -- "<source_key 정규식>" "<제목>" "<출력.pdf>" [문제편|해설편|둘다]');
    process.exit(1);
  }
  const editions: ('문제편' | '해설편')[] =
    editionArg === '둘다' ? ['문제편', '해설편'] : editionArg === '문제편' ? ['문제편'] : ['해설편'];

  const [tb, re] = pattern.includes('::') ? pattern.split('::', 2) : ['', pattern];
  const db = await getDb('gomijoshua');
  const ps = await db.collection('passages')
    .find({ ...(tb ? { textbook: tb } : {}), source_key: { $regex: re } })
    .project({ source_key: 1, textbook: 1, page_label: 1, page: 1 })
    .sort({ source_key: 1 })
    .toArray();

  const sources: SheetPassageSource[] = [];
  for (const p of ps) {
    const d = await db.collection('passage_analyses')
      .findOne({ fileName: passageAnalysisFileNameForPassageId(String(p._id)) }) as Record<string, any> | null;
    const m = d?.passageStates?.main;
    if (!m?.sentences?.length) { console.log(`  · 건너뜀(분석 없음) ${p.source_key}`); continue; }
    sources.push({
      textbook: String(p.textbook ?? ''),
      sourceKey: String(p.source_key ?? ''),
      pageLabel: String(p.page_label ?? p.page ?? ''),
      main: m,
    });
  }
  const passages = buildSheetPassages(sources);
  if (!passages.length) throw new Error('분석이 있는 지문이 없습니다.');

  const puppeteer = await import('puppeteer-core');
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean) as string[];
  const executablePath = candidates.find((c) => fs.existsSync(c));
  if (!executablePath) throw new Error('로컬 Chrome 을 찾지 못했습니다.');

  const browser = await puppeteer.default.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath, headless: true,
  });
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  try {
    for (const edition of editions) {
      const html = buildAnalysisSheetHtml({
        title, subtitle: '지문 분석지', passages, brand: '', date,
        editionLabel: edition,
        options: edition === '문제편' ? QUESTION_EDITION_OPTIONS : {},
      });
      const page = await browser.newPage();
      await page.setContent(
        await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic', 'Noto Sans KR'] }),
        { waitUntil: 'load', timeout: 120_000 },
      );
      await page.evaluate(async () => {
        try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
      });
      const buf = await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '12mm', right: '11mm', bottom: '12mm', left: '11mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 12mm;display:flex;justify-content:space-between">
          <span>${title} · ${edition}</span><span class="pageNumber"></span></div>`,
      });
      await page.close();
      const out = editions.length > 1 ? outPath.replace(/\.pdf$/i, ` · ${edition}.pdf`) : outPath;
      fs.writeFileSync(out, buf);
      console.log(`✓ ${out}  지문 ${passages.length}개 · ${(buf.length / 1024).toFixed(0)}KB`);
    }
  } finally { await browser.close(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
