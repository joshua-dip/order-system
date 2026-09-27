/**
 * BW-20260921-001 — 어법 G/H 전번호 합본 + 낱말배열(필기란) 재생성
 */
import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  listGrammarWorkbooks,
  getGrammarWorkbook,
  type GrammarWorkbookFull,
} from '@/lib/grammar-workbooks-store';
import { buildBulkWorkbookHtml } from '@/lib/grammar-workbook-print';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';
import { loadKitPassagesBySourceKeys } from '@/lib/workbook-kit/load-passages';
import { generateWordArrangePassage } from '@/lib/workbook-kit/word-arrange-generate';
import { buildWordArrangeHtml } from '@/lib/workbook-kit/word-arrange-html';

const TEXTBOOK = '리더스뱅크 Level 6(2019)';
const KEYS = [
  'Unit 07 19번',
  'Unit 07 20번',
  'Unit 07 21번',
  'Unit 08 22번',
  'Unit 08 23번',
  'Unit 08 24번',
];

const OUT_CANDIDATES = [
  path.join(process.env.HOME || '.', 'Downloads', 'BW-20260921-001'),
  path.join(process.cwd(), '.tmp', 'BW-20260921-001'),
];

function resolveOut(): string {
  for (const p of OUT_CANDIDATES) {
    try {
      fs.mkdirSync(p, { recursive: true });
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error('출력 폴더를 만들 수 없습니다.');
}

async function loadDocsInOrder(): Promise<GrammarWorkbookFull[]> {
  const listed = await listGrammarWorkbooks({ textbook: TEXTBOOK, limit: 200 });
  const byKey = new Map(listed.map((r) => [r.sourceKey, r]));
  const docs: GrammarWorkbookFull[] = [];
  for (const k of KEYS) {
    const row = byKey.get(k);
    if (!row) {
      console.warn('no grammar doc', k);
      continue;
    }
    const full = await getGrammarWorkbook(row._id);
    if (full) docs.push(full);
  }
  return docs;
}

async function main() {
  const OUT = resolveOut();
  console.log('OUT', OUT);
  const margin = { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' };
  const docs = await loadDocsInOrder();
  console.log('grammar docs', docs.length, docs.map((d) => d.sourceKey).join(', '));
  if (!docs.length) throw new Error('어법 재고 없음 — 먼저 G/H 저장 필요');

  const gBulk = buildBulkWorkbookHtml(docs, {
    modes: ['G'],
    includePoints: false,
    layout: 'back',
    title: `${TEXTBOOK} 어법 양자택일 합본`,
  });
  if (!gBulk) throw new Error('G 합본 실패');
  const gPdf = await renderHtmlToPdf(gBulk.html, { margin });
  fs.writeFileSync(path.join(OUT, '어법_양자택일_전번호합본.pdf'), gPdf);
  console.log('G', gPdf.length);

  const hBulk = buildBulkWorkbookHtml(docs, {
    modes: ['H'],
    includePoints: false,
    layout: 'back',
    title: `${TEXTBOOK} 어법 오류수정 합본`,
  });
  if (!hBulk) throw new Error('H 합본 실패');
  const hPdf = await renderHtmlToPdf(hBulk.html, { margin });
  fs.writeFileSync(path.join(OUT, '어법_오류수정_전번호합본.pdf'), hPdf);
  console.log('H', hPdf.length);

  const passages = await loadKitPassagesBySourceKeys(TEXTBOOK, KEYS);
  const arrange = passages.map(generateWordArrangePassage).filter((r) => r.items.length > 0);
  const arrangeHtml = buildWordArrangeHtml(arrange, { textbook: TEXTBOOK });
  const arrangePdf = await renderHtmlToPdf(arrangeHtml, { margin });
  fs.writeFileSync(path.join(OUT, '낱말배열_전번호합본.pdf'), arrangePdf);
  console.log('arrange', arrangePdf.length);

  const parent = path.dirname(OUT);
  const base = path.basename(OUT);
  const zipPath = path.join(parent, `${base}.zip`);
  try {
    fs.rmSync(zipPath, { force: true });
    execSync(`/usr/bin/zip -r ${JSON.stringify(zipPath)} ${JSON.stringify(base)}`, {
      cwd: parent,
      stdio: 'inherit',
    });
    console.log('zip', zipPath, fs.statSync(zipPath).size);
  } catch (e) {
    console.warn('zip skip', e instanceof Error ? e.message : e);
  }
  console.log('DONE', OUT);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
