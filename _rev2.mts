import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { config } from 'dotenv';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.env.DOTENV_CONFIG_QUIET='true'; config({path:path.join(ROOT,'.env')}); config({path:path.join(ROOT,'.env.local')});
const { listGrammarWorkbooks, getGrammarWorkbook } = await import('./lib/grammar-workbooks-store');
const { buildPointsAnalysisHtml } = await import('./lib/grammar-workbook-html');
// 5월 21번 우선, 없으면 3월 21번
let list = await listGrammarWorkbooks({ textbook:'26년 5월 고3 영어모의고사', limit:200 });
let doc:any = null;
if (list.length) doc = await getGrammarWorkbook((list.find(w=>w.sourceKey.includes('21'))??list[0])._id);
if (!doc) { list = await listGrammarWorkbooks({ textbook:'26년 3월 고3 영어모의고사', limit:200 }); doc = await getGrammarWorkbook((list.find(w=>w.sourceKey.includes('21'))??list[0])._id); }
console.log('대상:', doc.sourceKey, '| 포인트:', (doc.modeData?.P?.points??[]).length);
const html = buildPointsAnalysisHtml({ title:doc.title, textbook:doc.textbook, sourceKey:doc.sourceKey, sentences:doc.sentences, points:(doc.modeData?.P?.points??[]) });
const pup=(await import('puppeteer-core')).default;
const b=await pup.launch({args:['--no-sandbox','--disable-setuid-sandbox'],defaultViewport:{width:980,height:560,deviceScaleFactor:2},executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage(); await p.setContent(html,{waitUntil:'load',timeout:60000}); await p.evaluate(async()=>{try{await (document as any).fonts?.ready;}catch{}});
// 지문 영역만 클립 (상단 헤더+지문)
const el = await p.$('.gw-anal-passage');
await el!.screenshot({ path:'/tmp/passage.png' });
await b.close(); console.log('saved');
