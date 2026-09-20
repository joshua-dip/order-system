import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { Browser } from 'puppeteer-core';
import { getDb } from '@/lib/mongodb';
import { buildNarrativePrintHtml, narrativeTypePrintName, type NarrativePrintQuestion } from '@/lib/narrative-print-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

/**
 * 서술형(narrative_questions) 주문 → PDF. 객관식 cc:order-pdf 의 서술형 버전.
 *
 *   npm run cc:narrative-pdf -- <주문번호> [--zip] [--login <loginId>] [--out <폴더>]
 *
 * BD- 주문은 orderMeta 가 없고 orderText 안에 "05회: 31번, 32번, …" 형태로 지문 범위가
 * 적혀 있다 — 그 줄들을 정규식으로 읽어 source_key 목록("05회 31번")을 만들고,
 * textbook 은 orderText 의 "4. 교재: …" 줄에서 뽑는다. narrative_questions 에서
 * 그 source_key 들에 해당하는 문항을 모아 **subtype 별로 한 파일씩** 낸다
 * (subtype 은 실제 저장된 것만 — 주문서 체크박스를 전부 만들 필요는 없다, 예: Hard만).
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** orderText 에서 "05회: 31번, 32번, 33번" 같은 줄들을 source_key 목록으로 */
function parseSourceKeysFromOrderText(orderText: string): string[] {
  const keys: string[] = [];
  const lineRe = /^\s*(\S*?\d+회)\s*[:：]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(orderText))) {
    const round = m[1].trim();
    const nums = m[2].split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    for (const n of nums) {
      const mm = n.match(/(\d+번)/);
      if (mm) keys.push(`${round} ${mm[1]}`);
    }
  }
  return keys;
}

function parseTextbookFromOrderText(orderText: string): string {
  const m = orderText.match(/교재\s*[:：]\s*(.+)/);
  return m ? m[1].trim() : '';
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

async function zipFolder(dir: string, orderNumber: string, dest: string): Promise<number> {
  const zip = new JSZip();
  const names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  for (const name of names) {
    zip.file(`${orderNumber}/${name}`.normalize('NFC'), fs.readFileSync(path.join(dir, name)), { createFolders: false });
  }
  fs.writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return names.length;
}

/** source_key ("05회 31번") 의 회차 정렬키 */
function sortKey(sourceKey: string): [string, number] {
  const m = sourceKey.match(/^(\S+)\s+(\d+)번/);
  return m ? [m[1], Number(m[2])] : [sourceKey, 0];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const on = args.find((a) => /^[A-Z]{2}-\d{8}-\d{3,}$/.test(a));
  if (!on) {
    console.log('사용법: npm run cc:narrative-pdf -- <주문번호> [--zip] [--login <loginId>] [--out <폴더>]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const order = (await db.collection('orders').findOne({ orderNumber: on })) as Doc | null;
  if (!order) {
    console.log(`${on}: 주문 없음`);
    process.exit(1);
  }
  const orderText = str(order.orderText);
  const sourceKeys = parseSourceKeysFromOrderText(orderText);
  const textbook = parseTextbookFromOrderText(orderText);
  if (!sourceKeys.length || !textbook) {
    console.log('⚠ orderText 에서 교재·지문 범위를 읽지 못했습니다.');
    console.log({ textbook, sourceKeysFound: sourceKeys.length });
    process.exit(1);
  }
  console.log(`${on} | 교재 ${textbook} | 지문 ${sourceKeys.length}개`);

  const loginId = argValue(args, '--login') ?? str(order.loginId);
  const user = loginId ? ((await db.collection('users').findOne({ loginId })) as Doc | null) : null;
  const member = str(user?.name).trim() || loginId || '회원';
  const root = argValue(args, '--out') ?? path.join(os.homedir(), 'Downloads', `${member} 선생님 자료`);
  const outDir = path.join(root, on);

  const docs = (await db
    .collection('narrative_questions')
    .find({ textbook, source_key_matched: { $in: sourceKeys } })
    .toArray()) as Doc[];
  console.log(`  narrative_questions 매칭 ${docs.length}건`);
  if (!docs.length) {
    console.log('⚠ 저장된 서술형 문항이 없습니다.');
    process.exit(1);
  }

  const bySubtype = new Map<string, Doc[]>();
  for (const d of docs) {
    const sub = str((d.question_data as Doc | undefined)?.['문제유형']) || str(d.narrative_subtype) || '기타';
    if (!bySubtype.has(sub)) bySubtype.set(sub, []);
    bySubtype.get(sub)!.push(d);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    for (const [subtype, rows] of bySubtype) {
      rows.sort((a, b) => {
        const ka = sortKey(str(a.source_key_matched));
        const kb = sortKey(str(b.source_key_matched));
        return ka[0] === kb[0] ? ka[1] - kb[1] : ka[0].localeCompare(kb[0]);
      });
      const typeName = narrativeTypePrintName(subtype);
      const questions: NarrativePrintQuestion[] = rows.map((r) => {
        const qd = (r.question_data as Doc | undefined) ?? {};
        return {
          source: str(r.source_key_matched),
          question: str(qd['문제']),
          body: str(qd['본문']),
          score: Number(qd['점수']) || undefined,
          sampleAnswer: str(qd['모범답안']),
          explanation: str(qd['해설']),
        };
      });
      const html = buildNarrativePrintHtml({
        title: `${textbook} · ${typeName}`,
        subtitle: `${textbook} · 총 ${questions.length}문항`,
        questions,
        includeAnswers: true,
      });
      const buf = await renderPdf(browser, html);
      const fileName = `${typeName}.pdf`.replace(/[\\/:*?"<>|]+/g, '_');
      fs.writeFileSync(path.join(outDir, fileName), buf);
      console.log(`  ✓ ${fileName} · ${questions.length}문항 · ${(buf.length / 1024).toFixed(0)}KB`);
    }
  } finally {
    await browser.close();
  }

  if (args.includes('--zip')) {
    const dest = path.join(argValue(args, '--out') ?? path.join(os.homedir(), 'Downloads'), `${on}.zip`);
    console.log(`🗜 ${dest} (${await zipFolder(outDir, on, dest)}개)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
