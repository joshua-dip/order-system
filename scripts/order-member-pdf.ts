import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { Browser } from 'puppeteer-core';
import type { Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  buildVariantPrintHtml,
  normalizeVariantPrintFormat,
  variantTypePrintName,
  type VariantPrintFormat,
  type VariantPrintQuestion,
} from '@/lib/variant-print-html';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';
import {
  compareSourceLabel,
  fetchOrderQuestions,
  isSingleAnswerSequence,
  resolveOrderQuestionScope,
  sequenceSummary,
  type OrderQuestionRow,
  type OrderQuestionScope,
  type OrderScopeTarget,
} from '@/lib/order-answer-sequence';

/**
 * 주문 → 회원 인쇄 양식(users.variantPrintFormat) PDF. 관리자 인쇄 라우트와 같은 조판기(buildVariantPrintHtml)를 쓴다.
 *
 *   npm run cc:order-pdf -- <주문번호…> [--check] [--by type|round] [--zip] [--login <loginId>] [--out <폴더>]
 *
 *  - 회원은 주문의 loginId 로 찾는다(--login 으로 덮어쓰기). 기본 출력: ~/Downloads/<이름> 선생님 자료/<주문번호>/
 *  - --by type(기본): 유형별 파일 「<범위> <유형>.pdf」. --by round: 회차별 통합본 「1회 통합본.pdf」 —
 *    한 회차의 모든 유형을 번호 → 유형 순으로 묶는다(한 지문의 유형이 붙어 나와 수업에서 쓰기 쉽다).
 *  - status 완료 문항만, (출처, 유형)당 주문 수량만 낸다 — 지문에 쌓인 재고를 전부 내면 안 된다.
 *  - --check: PDF 없이 수량·부족·정답열만. --zip: ~/Downloads/<주문번호>.zip(--out 을 주면 그 폴더 안),
 *    UTF-8 파일명·NFC 라 윈도우에서 한글이 안 깨진다.
 * 납품 전 정답열(연속 같은 번호)은 npm run cc:answer-seq -- check 로 먼저 본다 — docs/variant/REVIEW.md §7.
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const roundOf = (source: string): string => source.split(' ').find((w) => /회$/.test(w)) ?? '';

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

function toPrintQuestion(r: OrderQuestionRow, label: string): VariantPrintQuestion {
  return {
    source: label,
    question: str(r.qd.Question),
    paragraph: str(r.qd.Paragraph),
    options: splitQuestionOptionSegments(str(r.qd.Options)),
    correctAnswer: r.answer,
    explanation: str(r.qd.Explanation ?? r.qd['해설']),
  };
}

interface Job {
  db: Db;
  scope: OrderQuestionScope;
  format: VariantPrintFormat;
  checkOnly: boolean;
  outDir: string;
  getBrowser: () => Promise<Browser>;
}

/** 유형별로 이 범위의 문항을 모으고 수량·부족·정답열을 보고한다. 부족 건수를 돌려준다. */
async function collect(job: Job, target: OrderScopeTarget, indent: string): Promise<{ byType: Map<string, OrderQuestionRow[]>; missing: number }> {
  const byType = new Map<string, OrderQuestionRow[]>();
  let missing = 0;
  for (const type of job.scope.types) {
    const per = job.scope.perType(type);
    const rows = await fetchOrderQuestions(job.db, target, type, { statuses: ['완료'], perSource: per });
    const have = new Map<string, number>();
    for (const r of rows) have.set(r.source, (have.get(r.source) ?? 0) + 1);
    const lacking = target.sources.filter((s) => (have.get(s) ?? 0) < per);
    missing += lacking.length;
    const seq = rows.map((r) => r.answer);
    const lack = lacking.length ? `  ⚠ 부족 ${lacking.length}: ${lacking.join(' / ')}` : '';
    const pattern = isSingleAnswerSequence(seq) ? `  ${sequenceSummary(seq)}` : '';
    console.log(`${indent}${type}: ${rows.length}/${target.sources.length * per}${lack}${pattern}`);
    byType.set(type, rows);
  }
  return { byType, missing };
}

async function writePdf(job: Job, title: string, subtitle: string, questions: VariantPrintQuestion[], fileName: string): Promise<void> {
  const html = buildVariantPrintHtml({
    title,
    subtitle,
    brand: job.format.brand,
    questions,
    includeAnswers: job.format.includeAnswers,
  });
  const buf = await renderPdf(await job.getBrowser(), html);
  fs.mkdirSync(job.outDir, { recursive: true });
  const name = fileName.replace(/[\\/:*?"<>|]+/g, '_');
  fs.writeFileSync(path.join(job.outDir, name), buf);
  console.log(`      ✓ ${name} · ${questions.length}문항 · ${(buf.length / 1024).toFixed(0)}KB`);
}

async function renderByType(job: Job, target: OrderScopeTarget, title: string): Promise<number> {
  const { byType, missing } = await collect(job, target, '    ');
  if (job.checkOnly) return missing;
  for (const [type, rows] of byType) {
    if (!rows.length) continue;
    const typeName = variantTypePrintName(type, job.format.hardSuffix);
    await writePdf(
      job,
      `${title} · ${typeName}`,
      `${title} · 총 ${rows.length}문항`,
      rows.map((r) => toPrintQuestion(r, r.source)),
      `${target.label} ${typeName}.pdf`,
    );
  }
  return missing;
}

async function renderByRound(job: Job, target: OrderScopeTarget): Promise<number> {
  const rounds = [...new Set(target.sources.map(roundOf))].sort((a, b) => compareSourceLabel(a, b));
  const kinds = job.scope.types.every((t) => /-고난도$/.test(t)) ? `고난도 ${job.scope.types.length}유형` : `${job.scope.types.length}유형`;
  let missing = 0;
  for (const rd of rounds) {
    const sub: OrderScopeTarget = { ...target, sources: target.sources.filter((s) => roundOf(s) === rd) };
    const scopeName = rd || target.label;
    console.log(`    [${scopeName}] 지문 ${sub.sources.length}`);
    const got = await collect(job, sub, '      ');
    missing += got.missing;
    if (job.checkOnly) continue;
    const rows = job.scope.types
      .flatMap((type) => (got.byType.get(type) ?? []).map((r) => ({ r, type })))
      .sort((a, b) => compareSourceLabel(a.r.source, b.r.source) || job.scope.types.indexOf(a.type) - job.scope.types.indexOf(b.type));
    if (!rows.length) continue;
    await writePdf(
      job,
      `${target.textbook} · ${scopeName} 통합본`,
      `${target.textbook} · ${scopeName} · 총 ${rows.length}문항 (${kinds})`,
      rows.map(({ r, type }) => toPrintQuestion(r, `${r.source} · ${variantTypePrintName(type, job.format.hardSuffix)}`)),
      `${rd ? rd.replace(/^0+(?=\d)/, '') : target.label} 통합본.pdf`,
    );
  }
  return missing;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const byRound = argValue(args, '--by') === 'round';
  const orderNumbers = args.filter((a) => /^[A-Z]{2}-\d{8}-\d{3,}$/.test(a));
  if (!orderNumbers.length) {
    console.log('사용법: npm run cc:order-pdf -- <주문번호…> [--check] [--by type|round] [--zip] [--login <loginId>] [--out <폴더>]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  let browser: Browser | null = null;
  const getBrowser = async (): Promise<Browser> => (browser ??= await launchBrowser());
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
      const job: Job = { db, scope, format, checkOnly, outDir: path.join(root, on), getBrowser };
      console.log(`\n═══ ${on} | 회원 ${member} | ${byRound ? '회차별 통합본' : '유형별'} | 양식 ${JSON.stringify(format)}`);
      if (!scope.targets.length) {
        console.log('  ⚠ 주문 범위(교재·지문)를 읽지 못했습니다');
        continue;
      }
      for (const target of scope.targets) {
        const title = target.label === target.textbook ? target.textbook : `${target.textbook} ${target.label}`;
        console.log(`  ▸ ${title} | 지문 ${target.sources.length} | 유형 ${scope.types.join(',')}`);
        missingTotal += byRound ? await renderByRound(job, target) : await renderByType(job, target, title);
      }
      if (!checkOnly && args.includes('--zip') && fs.existsSync(job.outDir)) {
        const dest = path.join(argValue(args, '--out') ?? path.join(os.homedir(), 'Downloads'), `${on}.zip`);
        console.log(`  🗜 ${dest} (${await zipFolder(job.outDir, on, dest)}개)`);
      }
    }
  } finally {
    const b = browser as Browser | null;
    if (b) await b.close();
  }
  console.log(`\n부족 합계 ${missingTotal}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
