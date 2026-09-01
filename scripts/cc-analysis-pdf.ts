/**
 * 분석지 PDF 뽑기 — 저장된 passage_analyses 를 그대로 읽어 한 문서로 낸다.
 *
 * 사용: npm run cc:analysis-pdf -- "<source_key 정규식>" "<제목>" "<출력경로>"
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { buildAnalysisPrintHtml, type AnalysisPrintPassage } from '@/lib/analysis-print-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

async function main() {
  const [pattern, title, outPath] = process.argv.slice(2);
  const db = await getDb('gomijoshua');
  const ps = await db.collection('passages')
    .find({ source_key: { $regex: pattern } })
    .project({ source_key: 1, textbook: 1 })
    .sort({ source_key: 1 })
    .toArray();

  const passages: AnalysisPrintPassage[] = [];
  let textbook = '';
  for (const p of ps) {
    textbook = String(p.textbook ?? textbook);
    const d = await db.collection('passage_analyses')
      .findOne({ fileName: passageAnalysisFileNameForPassageId(String(p._id)) }) as Record<string, any> | null;
    const m = d?.passageStates?.main;
    if (!m?.sentences?.length) { console.log(`  · 건너뜀(분석 없음) ${p.source_key}`); continue; }
    passages.push({
      label: String(p.source_key ?? ''),
      sentences: m.sentences,
      koreanSentences: m.koreanSentences ?? [],
      comprehensive: m.analysisResults?.comprehensive ?? {},
      topicSentences: m.topicHighlightedSentences ?? [],
      essaySentences: m.essayHighlightedSentences ?? [],
      sentenceBreaks: m.sentenceBreaks ?? {},
      grammarPoints: m.grammarPointsBySentence ?? {},
      vocabulary: (m.vocabularyList ?? []).map((v: Record<string, unknown>) => ({
        word: String(v.word ?? ''), meaning: String(v.meaning ?? ''),
        partOfSpeech: v.partOfSpeech as string | undefined,
        cefr: v.cefr as string | undefined,
        synonym: (v.synonym ?? v.antonym) as string | undefined,
      })),
    });
  }
  if (!passages.length) throw new Error('분석이 있는 지문이 없습니다.');

  const html = buildAnalysisPrintHtml({
    title,
    subtitle: `${textbook} · 지문 ${passages.length}개`,
    passages,
  });

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
  try {
    const page = await browser.newPage();
    await page.setContent(await prepareKoreanPdfHtml(html), { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      try { await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    });
    const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    fs.writeFileSync(outPath, buf);
    console.log(`✓ ${outPath}  지문 ${passages.length}개 · ${(buf.length / 1024).toFixed(0)}KB`);
  } finally { await browser.close(); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
