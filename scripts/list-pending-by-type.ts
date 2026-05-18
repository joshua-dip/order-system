/**
 * 일회성: 특정 textbook·type·status 의 generated_questions 목록을 가져와
 * (_id, source, CorrectAnswer)를 출력. 검수 자동화용 보조 스크립트.
 *
 * 사용:
 *   tsx scripts/list-pending-by-type.ts "<textbook>" "<type>" [status]
 *   tsx scripts/list-pending-by-type.ts "얇고 빠른 미니 모의고사 기본" "주제" "대기"
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

async function main() {
  const textbook = process.argv[2];
  const type = process.argv[3];
  const status = process.argv[4] ?? '대기';
  if (!textbook || !type) {
    console.error('usage: tsx scripts/list-pending-by-type.ts <textbook> <type> [status]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('generated_questions')
    .find({ textbook, type, status })
    .project({ source: 1, 'question_data.CorrectAnswer': 1 })
    .toArray();
  for (const d of docs) {
    const answer = (d as any).question_data?.CorrectAnswer ?? '';
    console.log(`${d._id.toString()}\t${(d as any).source}\t${answer}`);
  }
  console.log(`---\ntotal: ${docs.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e?.message ?? e);
  process.exit(1);
});
