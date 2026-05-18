/**
 * 일회성 정리: 24년 6월 고2 영어모의고사 18번 의 중복 저장된 4 건 삭제.
 * /loop 실행 중 save 명령이 2번 실행되어 4 난도 × 2 = 8 건이 됨.
 * 두 번째 배치 (newer createdAt) 4 건만 삭제하여 4 건 (난도 1 건씩) 만 남긴다.
 *
 * 사용: npx tsx scripts/delete-duplicate-essay-24-06-go2-18.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const PASSAGE_ID = '69e63b9a72a886137cd85028';
const DIFFICULTIES = ['기본난도', '중난도', '고난도', '최고난도'] as const;

async function main() {
  const db = await getDb('gomijoshua');
  const idsToDelete: any[] = [];

  for (const difficulty of DIFFICULTIES) {
    const docs = await db
      .collection('essay_exams')
      .find({ passageId: PASSAGE_ID, difficulty })
      .project({ _id: 1, createdAt: 1 })
      .sort({ createdAt: 1 })
      .toArray();

    console.log(`[${difficulty}] found ${docs.length} 문서`);
    for (const d of docs) console.log(`  - ${String(d._id)}  ${d.createdAt}`);

    if (docs.length <= 1) continue;
    // 가장 오래된 1 건만 유지 (첫 save 배치), 나머지 삭제
    const olderIds = docs.slice(1).map(d => d._id);
    idsToDelete.push(...olderIds);
  }

  if (idsToDelete.length === 0) {
    console.log('[skip] 삭제할 중복 없음');
    process.exit(0);
  }

  const r = await db.collection('essay_exams').deleteMany({ _id: { $in: idsToDelete } });
  console.log(`[after] deletedCount = ${r.deletedCount} — 난도별 최초 1 건만 유지`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
