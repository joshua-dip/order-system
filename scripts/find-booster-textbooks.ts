/** passages 컬렉션에서 textbook 에 'booster' 가 들어간 데이터 검사 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('passages');

  // 어떤 db / 어떤 collection 인지 명확히 확인
  console.log(`database = ${db.databaseName}`);
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log('collections:', collections.map(c => c.name).filter(n => /passage|textbook|booster/i.test(n)));

  const totalAll = await col.estimatedDocumentCount();
  console.log(`total passages (estimated) = ${totalAll}`);

  const patterns: { label: string; filter: Record<string, unknown> }[] = [
    { label: 'textbook ~ booster (case-insensitive)', filter: { textbook: { $regex: 'booster', $options: 'i' } } },
    { label: 'textbook ~ 부스터', filter: { textbook: { $regex: '부스터' } } },
    { label: 'source_key ~ booster (i)', filter: { source_key: { $regex: 'booster', $options: 'i' } } },
    { label: 'source_key ~ 부스터', filter: { source_key: { $regex: '부스터' } } },
    { label: 'chapter ~ booster (i)', filter: { chapter: { $regex: 'booster', $options: 'i' } } },
    { label: 'chapter ~ 부스터', filter: { chapter: { $regex: '부스터' } } },
    { label: 'content.original ~ booster (i)', filter: { 'content.original': { $regex: 'booster', $options: 'i' } } },
    { label: 'any string field ~ booster ($text 없이) — text-search 시도', filter: { $text: { $search: 'booster' } } },
  ];

  for (const p of patterns) {
    try {
      const c = await col.countDocuments(p.filter);
      console.log(`  ${String(c).padStart(5)}  ·  ${p.label}`);
    } catch (e) {
      console.log(`  err   ·  ${p.label}: ${(e as Error).message}`);
    }
  }

  // 모든 textbook 별 분포 — booster·부스터 문자열이 들어간 것만 보여주기
  console.log('\n--- textbook 전체 distinct 중 booster|부스터 포함 ---');
  const distinctTbs = (await col.distinct('textbook')) as unknown[];
  const matched = distinctTbs
    .map(v => String(v ?? ''))
    .filter(s => /booster|부스터/i.test(s));
  if (matched.length === 0) {
    console.log('(없음)');
    // 정상 작동 확인용으로 첫 textbook 몇 개만 샘플
    console.log('\n참고: distinct textbook 처음 10개 =');
    distinctTbs.slice(0, 10).forEach(v => console.log('  ·', String(v ?? '')));
    console.log(`distinct textbook 총 개수 = ${distinctTbs.length}`);
  } else {
    matched.forEach(t => console.log('  ·', t));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
