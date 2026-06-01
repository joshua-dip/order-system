import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });
const { listGrammarWorkbooks, getGrammarWorkbook } = await import('./lib/grammar-workbooks-store');
const { buildPointsAnalysisHtml } = await import('./lib/grammar-workbook-html');

const list = await listGrammarWorkbooks({ textbook: '26년 3월 고3 영어모의고사', limit: 200 });
const hit = list.find(w => w.sourceKey.includes('21')) ?? list[0];
console.log('대상:', hit.sourceKey, '| modes:', hit.modes, '| _id:', hit._id);
const doc = await getGrammarWorkbook(hit._id);
if (!doc) { console.log('doc 없음'); process.exit(0); }
const pts = (doc.modeData?.P?.points ?? []) as any[];
console.log('포인트:', pts.length, '| 문장:', doc.sentences.length);
const bySent = new Map<number, any[]>();
for (const p of pts) { const a = bySent.get(p.sentenceIdx)??[]; a.push(p); bySent.set(p.sentenceIdx,a); }
console.log('문장당:', [...bySent.entries()].sort((a,b)=>a[0]-b[0]).map(([s,a])=>`s${s}:${a.length}`).join(' '));
console.log('koCorrect 미입력:', pts.filter(p=>!(p.koCorrect??'').trim()).length);
console.log('explanation 미입력:', pts.filter(p=>!(p.explanation??'').trim()).length);
console.log('샘플 포인트:', pts.slice(0,4).map(p=>`${p.correctForm}/${p.grammarType}/ko:${p.koCorrect??'∅'}`));
const html = buildPointsAnalysisHtml({ title: doc.title, textbook: doc.textbook, sourceKey: doc.sourceKey, sentences: doc.sentences, points: pts });
const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'], defaultViewport:{width:820,height:1180,deviceScaleFactor:2}, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil:'load', timeout:60000 });
await page.evaluate(async()=>{ try{ await (document as any).fonts?.ready; }catch{} });
await page.screenshot({ path:'/tmp/review.png', fullPage:true });
await browser.close();
console.log('PNG saved');
