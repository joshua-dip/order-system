/**
 * READ-ONLY 점검: 파이널 예비 모의고사 "양정고1" 시험지의 지문별 문항 분포 + 재고.
 * 학생 신고("특정 지문에 문제가 쏠린다") 검증용.
 * MONGODB_URI 등 비밀은 절대 출력하지 않음. 어떤 쓰기도 하지 않음.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { FINAL_EXAM_JOBS_COLLECTION, type FinalExamJobDoc } from '../lib/final-exam-store';
import { matchGeneratedQuestionOptionTypeEnglish } from '../lib/question-count-validation';

function fmtPct(n: number, d: number) {
  if (!d) return '0%';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection<FinalExamJobDoc>(FINAL_EXAM_JOBS_COLLECTION);

  const jobs = await col
    .find({ $or: [{ school: { $regex: '양정' } }, { title: { $regex: '양정' } }, { scopeSummary: { $regex: '양정' } }] })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  console.log(`=== "양정" 매칭 final_exam_jobs: ${jobs.length}건 (최신순) ===\n`);

  for (const job of jobs) {
    const total = job.items.reduce((s, it) => s + it.questionIds.length, 0);
    const created = job.createdAt instanceof Date ? job.createdAt.toISOString().slice(0, 16).replace('T', ' ') : String(job.createdAt);
    console.log('────────────────────────────────────────────────────────');
    console.log(`jobId=${job._id}  "${job.title}"  createdAt=${created}  status=${job.status}`);
    console.log(`  selectedTypes(${job.selectedTypes.length})=[${job.selectedTypes.join(', ')}]  avoidDuplicates=${!!job.avoidDuplicates}`);

    const scopeSources = [...new Set(job.items.map((it) => it.sourceKey))];
    const bySource = new Map<string, number>();
    for (const it of job.items) bySource.set(it.sourceKey, (bySource.get(it.sourceKey) ?? 0) + it.questionIds.length);
    const sorted = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  범위 지문 ${scopeSources.length}개 → 30문항 배정 (이상적 균등 = 지문당 ${Math.round((total / Math.max(1, scopeSources.length)) * 10) / 10}문항)`);
    for (const [sk, c] of sorted) {
      console.log(`    ${String(c).padStart(2)} ${'█'.repeat(c).padEnd(14)} ${sk}  (${fmtPct(c, total)})`);
    }
    console.log('');
  }

  // ── 최신 30문항 시험지의 지문 × 유형 재고(완료·English) 매트릭스 ──
  const target = jobs.find((j) => /30문항/.test(j.title) && /28/.test(j.title)) ?? jobs[0];
  if (target) {
    console.log('════════════════════════════════════════════════════════');
    console.log(`재고 점검 대상: "${target.title}"`);
    const sources = [...new Set(target.items.map((it) => it.sourceKey))];
    const types = target.selectedTypes;

    // source_key → passageId
    const passages = await db
      .collection('passages')
      .find({ source_key: { $in: sources } })
      .project<{ _id: ObjectId; source_key?: string }>({ _id: 1, source_key: 1 })
      .toArray();
    const pid = new Map<string, ObjectId>();
    for (const p of passages) if (p.source_key) pid.set(p.source_key.trim(), p._id);

    const gq = db.collection('generated_questions');
    const eng = matchGeneratedQuestionOptionTypeEnglish();

    console.log('\n지문 × 유형별 "완료" 변형문항 보유 수 (English 보기 기준):');
    const header = ['유형'.padEnd(10), ...sources.map((s) => s.replace(' 고1 영어모의고사 30번', '').padStart(10))].join(' | ');
    console.log('  ' + header);
    console.log('  ' + '─'.repeat(header.length));
    const colTotals = new Map<string, number>();
    for (const t of types) {
      const cells: string[] = [];
      for (const s of sources) {
        const p = pid.get(s.trim());
        const n = p ? await gq.countDocuments({ passage_id: p, type: t, status: '완료', ...eng }) : 0;
        colTotals.set(s, (colTotals.get(s) ?? 0) + n);
        cells.push((n === 0 ? '·0' : String(n)).padStart(10));
      }
      console.log('  ' + t.padEnd(10) + ' | ' + cells.join(' | '));
    }
    console.log('  ' + '─'.repeat(header.length));
    console.log('  ' + '합계'.padEnd(10) + ' | ' + sources.map((s) => String(colTotals.get(s) ?? 0).padStart(10)).join(' | '));
    console.log('\n  (·0 = 그 지문에 그 유형의 완료 문항이 아예 없음 → 그 유형은 다른 지문으로 몰릴 수밖에 없음)');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
