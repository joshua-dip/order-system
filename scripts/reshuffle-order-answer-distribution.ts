/**
 * 주문(지문 집합)의 셔플O 유형 변형문제를 재셔플해 정답 ①~⑤ 분포를 고르게 한다.
 * 저장 경로와 동일한 lib/variant-save-generated-question.shuffleQuestionDataForDistribution 사용.
 * 비셔플 유형(순서·삽입·어법·무관 등)은 제외. 단일 동그라미 정답·Options 5분할(###) 인 것만 실제 셔플.
 *
 * 기본은 dry-run. 실제 적용은 --apply.
 *   npx tsx scripts/reshuffle-order-answer-distribution.ts            # dry-run (현재·예상 분포)
 *   npx tsx scripts/reshuffle-order-answer-distribution.ts --apply    # 적용 + 백업 저장
 *   passage id 들을 인자로 주면 그 지문들로 한정 (기본: MV-20260623-001 5개 지문)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { shuffleQuestionDataForDistribution } from '@/lib/variant-save-generated-question';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

// MV-20260623-001 scopePassageIds
const DEFAULT_PASSAGE_IDS = [
  '6a16b05dbab3d98365c345d8',
  '6a16adcebab3d98365c345bf',
  '6a16adcebab3d98365c345c0',
  '6a16adcebab3d98365c345c4',
  '6a16adcebab3d98365c345c7',
];

// 저장 경로 SHUFFLABLE_TYPES 와 동일
const SHUFFLABLE = [
  '주제', '제목', '주장', '일치', '불일치', '함의', '함의-고난도',
  '빈칸', '빈칸-고난도', '요약', '요약-고난도',
  '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
];

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

function dist(cas: string[]): Record<string, number> {
  const d: Record<string, number> = { '①': 0, '②': 0, '③': 0, '④': 0, '⑤': 0, '기타': 0 };
  for (const ca of cas) d[/^[①②③④⑤]$/.test(ca) ? ca : '기타'] += 1;
  return d;
}
function fmtDist(d: Record<string, number>): string {
  const single = CIRCLED.reduce((a, c) => a + d[c], 0);
  const onePct = single ? Math.round((d['①'] / single) * 1000) / 10 : 0;
  return CIRCLED.map((c) => `${c}${d[c]}`).join(' ') + (d['기타'] ? ` 기타${d['기타']}` : '') + `  | ①비율 ${onePct}%`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const argIds = process.argv.slice(2).filter((s) => /^[0-9a-fA-F]{24}$/.test(s));
  const passageIds = (argIds.length ? argIds : DEFAULT_PASSAGE_IDS).map((s) => new ObjectId(s));

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('generated_questions')
    .find({ passage_id: { $in: passageIds }, type: { $in: SHUFFLABLE } })
    .toArray();

  const before: string[] = [];
  const after: string[] = [];
  const changes: { _id: ObjectId; before: Record<string, unknown>; afterQd: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const caBefore = String(qd.CorrectAnswer ?? '').trim();
    before.push(caBefore);
    const newQd = shuffleQuestionDataForDistribution({ ...qd });
    const optChanged = String(newQd.Options ?? '') !== String(qd.Options ?? '');
    if (optChanged) {
      after.push(String(newQd.CorrectAnswer ?? '').trim());
      changes.push({
        _id: d._id as ObjectId,
        before: { CorrectAnswer: qd.CorrectAnswer, Options: qd.Options, Explanation: qd.Explanation },
        afterQd: newQd,
      });
    } else {
      after.push(caBefore); // 셔플 불가(no-op): 그대로 유지
      skipped += 1;
    }
  }

  console.log(`\n대상 셔플O 문항: ${docs.length}건 (지문 ${passageIds.length}개)`);
  console.log(`  셔플 적용 가능: ${changes.length}건 / no-op(형식 미달): ${skipped}건`);
  console.log(`\n현재 분포 : ${fmtDist(dist(before))}`);
  console.log(`예상 분포 : ${fmtDist(dist(after))}`);

  if (!apply) {
    console.log(`\n[dry-run] 적용하려면 --apply 를 붙여 다시 실행하세요.\n`);
    process.exit(0);
  }

  // 백업
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join('/tmp', `reshuffle-backup-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(changes.map((c) => ({ _id: String(c._id), ...c.before })), null, 2),
    'utf8',
  );
  console.log(`\n백업 저장: ${backupPath} (${changes.length}건의 원본 CorrectAnswer/Options/Explanation)`);

  const now = new Date();
  let updated = 0;
  for (const c of changes) {
    const r = await db.collection('generated_questions').updateOne(
      { _id: c._id },
      { $set: { question_data: c.afterQd, updated_at: now } },
    );
    if (r.modifiedCount === 1) updated += 1;
  }
  console.log(`적용 완료: ${updated}/${changes.length}건 updateOne 갱신\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
