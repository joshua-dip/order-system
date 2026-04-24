/**
 * "지금필수 고난도유형(2024)" → "지금필수 고난도유형(2026)" 일괄 변경
 * 
 * 대상 컬렉션:
 * - orders (변형문제 주문서, 워크북 주문서)
 * - passages
 * - generated_questions
 * - essay_exams
 * - user_vocabularies
 * - 기타 textbook 필드를 가진 모든 컬렉션
 * 
 * 사용법:
 *   npx tsx scripts/update-textbook-2024-to-2026.ts [--dry-run] [--collection <name>]
 */

import { config } from 'dotenv';
import path from 'path';
import { getDb } from '@/lib/mongodb';

config({ path: path.join(process.cwd(), '.env') });
config({ path: path.join(process.cwd(), '.env.local') });

const OLD = '지금필수 고난도유형(2024)';
const NEW = '지금필수 고난도유형(2026)';

// 업데이트할 컬렉션과 필드 목록
const COLLECTIONS = [
  { name: 'orders', fields: ['textbook', 'questionCounts.textbook'] },
  { name: 'passages', fields: ['textbook'] },
  { name: 'generated_questions', fields: ['textbook'] },
  { name: 'essay_exams', fields: ['textbook'] },
  { name: 'user_vocabularies', fields: ['textbook'] },
  { name: 'generated_workbooks', fields: ['textbook'] },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetCollection = args.find((a, i) => args[i - 1] === '--collection');

  console.log(`\n=== 지금필수 고난도유형 (2024) → (2026) 업데이트 ===`);
  console.log(`모드: ${dryRun ? 'DRY RUN (실제 변경 안 함)' : '실제 변경'}\n`);

  const db = await getDb('gomijoshua');
  
  const collections = targetCollection
    ? COLLECTIONS.filter(c => c.name === targetCollection)
    : COLLECTIONS;

  if (collections.length === 0) {
    console.error(`❌ 컬렉션을 찾을 수 없습니다: ${targetCollection}`);
    process.exit(1);
  }

  let totalUpdated = 0;

  for (const { name, fields } of collections) {
    console.log(`\n📦 ${name} 컬렉션:`);
    
    try {
      const collection = db.collection(name);
      
      // 각 필드별로 조회 및 업데이트
      for (const field of fields) {
        const query = { [field]: OLD };
        const count = await collection.countDocuments(query);
        
        if (count === 0) {
          console.log(`  ${field}: 변경 대상 없음`);
          continue;
        }

        console.log(`  ${field}: ${count}건 발견`);

        if (!dryRun) {
          const result = await collection.updateMany(
            query,
            { $set: { [field]: NEW } }
          );
          console.log(`  ✓ ${result.modifiedCount}건 업데이트됨`);
          totalUpdated += result.modifiedCount;
        } else {
          console.log(`  [DRY RUN] ${count}건 업데이트 예정`);
        }

        // 샘플 문서 출력 (최대 3개)
        if (count > 0) {
          const samples = await collection
            .find(query)
            .limit(3)
            .project({ _id: 1, [field]: 1 })
            .toArray();
          console.log(`  샘플:`, samples.map(s => ({ _id: String(s._id), [field]: s[field] })));
        }
      }
    } catch (error) {
      console.error(`  ❌ 오류:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\n=== 요약 ===`);
  if (dryRun) {
    console.log(`DRY RUN 모드 — 실제 변경 없음`);
  } else {
    console.log(`총 ${totalUpdated}건 업데이트 완료`);
  }
  console.log();

  process.exit(0);
}

main().catch(e => {
  console.error('오류:', e);
  process.exit(1);
});
