const fs = require('fs');
const path = require('path');
const puppeteer = require(path.join(__dirname, '../../../node_modules/puppeteer-core'));
(async () => {
  const S = process.argv[2] || path.join(__dirname);
  const src = fs.readFileSync(path.join(S, 'notebook.html'), 'utf8');
  // 인쇄용: 한 단, 목차 숨김, 밝은 색 고정, 과가 페이지 사이에서 잘리지 않게
  const printCss = `<style>
    @page { size: A4; margin: 16mm 15mm 18mm; }
    body { padding: 0 !important; font-size: 13.5px; line-height: 1.7; background: #fff !important; }
    .wrap { display: block !important; max-width: none !important; }
    nav.toc { display: none !important; }
    header.top { margin-bottom: 18px; }
    main { display: block !important; }
    section { margin-bottom: 30px; gap: 12px !important; }
    section + section { border-top: 1px solid #dfe3e8; padding-top: 22px; }
    .ours, pre, .flow, .chart, table, .score, .pair { break-inside: avoid; }
    h2, .num, .one { break-after: avoid; }
    section > .num, section > h2 { break-inside: avoid; }

    .chart svg { min-width: 0 !important; }
    p, .one { max-width: none !important; }
    .ours { background: #f7f8fa !important; }
  </style>`;
  const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8">' + src.replace('</style>', '</style>' + printCss) + '</head><body></body></html>';
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    const out = path.join(process.env.HOME, 'Downloads', '변형문제 LoRA 실습 노트.pdf');
    await page.pdf({
      path: out, format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#8a939f;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    const n = (fs.readFileSync(out).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
    console.log('saved', out, n + '쪽', Math.round(fs.statSync(out).size / 1024) + 'KB');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
