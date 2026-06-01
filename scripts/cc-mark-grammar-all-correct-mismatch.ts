/**
 * 어법 해설 모순(모든 어법이 맞다고 단언) 문항을 검출 → questionStatus='검수불일치' 일괄 마킹.
 * Pro-only · Anthropic API 호출 없음. 일회성 정리.
 *
 *   npx tsx scripts/cc-mark-grammar-all-correct-mismatch.ts            # dry-run
 *   npx tsx scripts/cc-mark-grammar-all-correct-mismatch.ts --apply    # 실제 적용
 *   --textbook="…" 옵션으로 교재 제한 가능.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { detectAllCorrectClaim } from '../lib/grammar-explanation-all-correct';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyStrong = !args.includes('--include-weak');
  const textbook = args
    .find((a) => a.startsWith('--textbook='))
    ?.slice('--textbook='.length);

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const match: Record<string, unknown> = { type: '어법' };
  if (textbook) match.textbook = textbook;

  const docs = await col
    .find(match)
    .project({
      _id: 1,
      textbook: 1,
      source: 1,
      status: 1,
      questionStatus: 1,
      'question_data.Explanation': 1,
      'question_data.CorrectAnswer': 1,
    })
    .toArray();

  const targets: {
    id: ObjectId;
    textbook: string;
    source: string;
    status: string;
    correct: string;
    labels: string[];
    strong: boolean;
  }[] = [];
  for (const d of docs) {
    const qd = (d.question_data as Record<string, unknown>) || {};
    const expl = typeof qd.Explanation === 'string' ? (qd.Explanation as string) : '';
    const hits = detectAllCorrectClaim(expl);
    if (hits.length === 0) continue;
    const strong = hits.some((h) => h.strong);
    if (onlyStrong && !strong) continue;
    targets.push({
      id: d._id as ObjectId,
      textbook: String(d.textbook ?? ''),
      source: String(d.source ?? ''),
      status: String(d.status ?? d.questionStatus ?? ''),
      correct: typeof qd.CorrectAnswer === 'string' ? (qd.CorrectAnswer as string) : '',
      labels: hits.map((h) => h.label),
      strong,
    });
  }

  console.log(
    `[scan] scanned=${docs.length} hits=${targets.length} (onlyStrong=${onlyStrong}${textbook ? ` textbook=${textbook}` : ''})`,
  );
  for (const t of targets) {
    console.log(
      `  • ${t.id.toHexString()}  status=${t.status || '(미설정)'}  CorrectAnswer=${t.correct}  [${t.labels.join(', ')}]  ${t.textbook} / ${t.source}`,
    );
  }
  const needUpdate = targets.filter((t) => t.status !== '검수불일치');
  console.log(`\n[plan] 변경 대상 ${needUpdate.length}건 (이미 검수불일치인 ${targets.length - needUpdate.length}건 제외)`);
  if (!apply) {
    console.log('[dry-run] --apply 를 붙이면 실제로 questionStatus 를 변경합니다.');
    process.exit(0);
  }
  if (needUpdate.length === 0) {
    console.log('[apply] 변경할 항목이 없습니다.');
    process.exit(0);
  }
  const res = await col.updateMany(
    { _id: { $in: needUpdate.map((t) => t.id) } },
    {
      $set: { status: '검수불일치', updated_at: new Date() },
      $unset: { questionStatus: '' },
    },
  );
  console.log(`[apply] matched=${res.matchedCount} modified=${res.modifiedCount}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
