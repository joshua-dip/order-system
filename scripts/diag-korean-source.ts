/** 특정 지문의 한국어 해석이 어디에 저장되어 있는지 진단 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const sourceKey = process.argv[2] ?? '고난도 모의고사 2회 01번';
  const db = await getDb('gomijoshua');

  const p = await db
    .collection('passages')
    .findOne({ source_key: sourceKey });
  if (!p) {
    console.log('passage not found for source_key=', sourceKey);
    return;
  }
  const id = String(p._id);
  console.log('passage._id =', id);
  console.log('textbook =', p.textbook, ' chapter=', p.chapter, ' number=', p.number);

  const c = (p.content ?? {}) as Record<string, unknown>;
  const skoArr = Array.isArray(c.sentences_ko) ? (c.sentences_ko as unknown[]) : [];
  const senArr = Array.isArray(c.sentences_en) ? (c.sentences_en as unknown[]) : [];
  console.log('content.original length =', String(c.original ?? '').length);
  console.log('content.translation length =', String(c.translation ?? '').length);
  console.log('content.sentences_en length =', senArr.length);
  console.log('content.sentences_ko length =', skoArr.length);
  console.log('content.sentences_ko 첫 2개 =', skoArr.slice(0, 2));
  if (typeof c.translation === 'string' && c.translation.length > 0) {
    console.log('content.translation 미리보기 =', c.translation.slice(0, 200));
  }

  const fileName = passageAnalysisFileNameForPassageId(id);
  const ana = await db
    .collection('passage_analyses')
    .findOne({ fileName });
  if (!ana) {
    console.log('passage_analyses[fileName=' + fileName + '] not found');
    return;
  }
  const states = (ana as { passageStates?: Record<string, unknown> }).passageStates ?? {};
  console.log('passageStates keys =', Object.keys(states));
  for (const [k, v] of Object.entries(states)) {
    const main = v as Record<string, unknown>;
    const ko = Array.isArray(main.koreanSentences) ? main.koreanSentences : [];
    const en = Array.isArray(main.sentences) ? main.sentences : [];
    console.log(`  states[${k}].sentences=${en.length}, koreanSentences=${ko.length}`);
    console.log(`  states[${k}].koreanSentences[0..1] =`, (ko as unknown[]).slice(0, 2));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
