import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { Browser } from 'puppeteer-core';
import { getDb } from '@/lib/mongodb';
import {
  buildVariantPrintHtml,
  normalizeVariantPrintFormat,
  variantTypePrintName,
  type VariantPrintQuestion,
} from '@/lib/variant-print-html';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';
import {
  fetchOrderQuestions,
  isSingleAnswerSequence,
  resolveOrderQuestionScope,
  sequenceSummary,
} from '@/lib/order-answer-sequence';

/**
 * 주문 → 회원 인쇄 양식(users.variantPrintFormat) PDF. 관리자 인쇄 라우트와 같은 조판기(buildVariantPrintHtml)를 쓴다.
 *
 *   npm run cc:order-pdf -- <주문번호…> [--check] [--zip] [--login <loginId>] [--out <폴더>]
 *
 *  - 회원은 주문의 loginId 로 찾는다(--login 으로 덮어쓰기). 기본 출력: ~/Downloads/<이름> 선생님 자료/<주문번호>/<범위> <유형>.pdf
 *  - status 완료 문항만, (출처, 유형)당 주문 수량만 낸다 — 지문에 쌓인 재고를 전부 내면 안 된다.
 *  - --check: PDF 없이 수량·부족·정답열만. --zip: ~/Downloads/<주문번호>.zip (UTF-8 파일명·NFC — 윈도우에서 한글이 안 깨짐)
 * 납품 전 정답열(연속 같은 번호)은 npm run cc:answer-seq -- check 로 먼저 본다 — docs/variant/REVIEW.md §7.
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function zipFolder(dir: string, orderNumber: string, dest: string): Promise<number> {
  const zip = new JSZip();
  const names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  for (const name of names) {
    zip.file(`${orderNumber}/${name}`.normalize('NFC'), fs.readFileSync(path.join(dir, name)), { createFolders: false });
  }
  fs.writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return names.length;
}

async function launchBrowser(): Promise<Browser> {
  const exe = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find((c) => fs.existsSync(c));
  if (!exe) throw new Error('Chrome/Chromium 을 찾지 못했습니다');
  const puppeteer = await import('puppeteer-core');
  return puppeteer.default.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath: exe,
    headless: true,
    protocolTimeout: 280_000,
  });
}

async function renderPdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }), {
      waitUntil: 'load',
      timeout: 120_000,
    });
    await page.evaluate(async () => {
      await document.fonts?.ready;
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      timeout: 0,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const orderNumbers = args.filter((a) => /^[A-Z]{2}-\d{8}-\d{3,}$/.test(a));
  if (!orderNumbers.length) {
    console.log('사용법: npm run cc:order-pdf -- <주문번호…> [--check] [--zip] [--login <loginId>] [--out <폴더>]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  let browser: Browser | null = null;
  let missingTotal = 0;
  try {
    for (const on of orderNumbers) {
      const order = (await db.collection('orders').findOne({ orderNumber: on })) as Doc | null;
      if (!order) {
        console.log(`${on}: 주문 없음`);
        continue;
      }
      const scope = resolveOrderQuestionScope(order);
      const loginId = argValue(args, '--login') ?? scope.loginId;
      const user = loginId ? ((await db.collection('users').findOne({ loginId })) as Doc | null) : null;
      const format = normalizeVariantPrintFormat(user?.variantPrintFormat);
      const member = str(user?.name).trim() || loginId || '회원';
      const root = argValue(args, '--out') ?? path.join(os.homedir(), 'Downloads', `${member} 선생님 자료`);
      const outDir = path.join(root, on);
      console.log(`\n═══ ${on} | 회원 ${member} | 양식 ${JSON.stringify(format)}`);
      if (!scope.targets.length) {
        console.log('  ⚠ 주문 범위(교재·지문)를 읽지 못했습니다');
        continue;
      }
      for (const target of scope.targets) {
        const title = target.label === target.textbook ? target.textbook : `${target.textbook} ${target.label}`;
        console.log(`  ▸ ${title} | 지문 ${target.sources.length} | 유형 ${scope.types.join(',')}`);
        for (const type of scope.types) {
          const per = scope.perType(type);
          const rows = await fetchOrderQuestions(db, target, type, { statuses: ['완료'], perSource: per });
          const have = new Map<string, number>();
          for (const r of rows) have.set(r.source, (have.get(r.source) ?? 0) + 1);
          const missing = target.sources.filter((s) => (have.get(s) ?? 0) < per);
          missingTotal += missing.length;
          const seq = rows.map((r) => r.answer);
          const lack = missing.length ? `  ⚠ 부족 ${missing.length}: ${missing.join(' / ')}` : '';
          const pattern = isSingleAnswerSequence(seq) ? `  ${sequenceSummary(seq)}` : '';
          console.log(`    ${type}: ${rows.length}/${target.sources.length * per}${lack}${pattern}`);
          if (checkOnly || !rows.length) continue;

          const typeName = variantTypePrintName(type, format.hardSuffix);
          const questions: VariantPrintQuestion[] = rows.map((r) => ({
            source: r.source,
            question: str(r.qd.Question),
            paragraph: str(r.qd.Paragraph),
            options: splitQuestionOptionSegments(str(r.qd.Options)),
            correctAnswer: r.answer,
            explanation: str(r.qd.Explanation ?? r.qd['해설']),
          }));
          const html = buildVariantPrintHtml({
            title: `${title} · ${typeName}`,
            subtitle: `${title} · 총 ${questions.length}문항`,
            brand: format.brand,
            questions,
            includeAnswers: format.includeAnswers,
          });
          browser ??= await launchBrowser();
          const buf = await renderPdf(browser, html);
          fs.mkdirSync(outDir, { recursive: true });
          const name = `${target.label} ${typeName}.pdf`.replace(/[\\/:*?"<>|]+/g, '_');
          fs.writeFileSync(path.join(outDir, name), buf);
          console.log(`      ✓ ${name} · ${(buf.length / 1024).toFixed(0)}KB`);
        }
      }
      if (!checkOnly && args.includes('--zip') && fs.existsSync(outDir)) {
        /* 기본은 ~/Downloads/<주문번호>.zip, --out 을 주면 그 폴더 안 */
        const dest = path.join(argValue(args, '--out') ?? path.join(os.homedir(), 'Downloads'), `${on}.zip`);
        console.log(`  🗜 ${dest} (${await zipFolder(outDir, on, dest)}개)`);
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  console.log(`\n부족 합계 ${missingTotal}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
