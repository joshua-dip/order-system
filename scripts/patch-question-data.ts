import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import type { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { writeVariantBackup } from '@/lib/order-answer-sequence';

/**
 * 저장된 변형문항 한 건의 question_data 일부를 교체한다 — 재저장(중복 insert) 대신 쓰는 패치.
 * draft 는 prevalidate-variants.ts 형식 배열이고, 첫 원소의 Question·Paragraph·Options·CorrectAnswer·Explanation 중
 * 기존과 다른 필드만 $set 한다. 대상 문항과 passage_id·type·source 가 같은지 확인한다.
 *
 *   npx tsx scripts/prevalidate-variants.ts <draft.json>                     # 먼저 0 에러 확인
 *   npx tsx scripts/patch-question-data.ts --serial <번호> --json <draft.json> [--apply]
 */

type Doc = Record<string, unknown>;
const FIELDS = ['Question', 'Paragraph', 'Options', 'CorrectAnswer', 'Explanation'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const serial = args.includes('--serial') ? args[args.indexOf('--serial') + 1] : undefined;
  const file = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
  if (!serial || !file) {
    console.log('사용법: npx tsx scripts/patch-question-data.ts --serial <번호> --json <draft.json> [--apply]');
    process.exit(1);
  }
  const draft = (JSON.parse(fs.readFileSync(file, 'utf8')) as Doc[])[0];
  const draftData = (draft?.question_data ?? {}) as Doc;
  const db = await getDb('gomijoshua');
  const q = (await db.collection('generated_questions').findOne({
    $or: [{ serialNo: Number(serial) }, { serialNo: serial }, { serialNo: `V-${serial}` }],
  })) as Doc | null;
  if (!q) throw new Error(`serialNo ${serial} 없음`);
  if (String(q.passage_id) !== String(draft.passage_id) || q.type !== draft.type || q.source !== draft.source) {
    throw new Error(
      `대상 불일치: DB ${String(q.source)}/${String(q.type)}/${String(q.passage_id)} ≠ draft ${String(draft.source)}/${String(draft.type)}/${String(draft.passage_id)}`,
    );
  }
  const current = (q.question_data ?? {}) as Doc;
  const set: Doc = {};
  for (const k of FIELDS) {
    const next = draftData[k];
    if (typeof next !== 'string' || next === current[k]) continue;
    set[`question_data.${k}`] = next;
    console.log(`── ${k}\n  [전] ${String(current[k] ?? '').replace(/\n/g, ' ⏎ ')}\n  [후] ${next.replace(/\n/g, ' ⏎ ')}`);
  }
  console.log(`${String(q.source)} ${String(q.type)} serial=${String(q.serialNo)} status=${String(q.status)} — 변경 필드 ${Object.keys(set).length}`);
  if (!Object.keys(set).length) process.exit(0);
  if (!apply) {
    console.log('[dry-run] 적용하려면 --apply');
    process.exit(0);
  }
  const backup = writeVariantBackup(`patch-${serial}`, { _id: String(q._id), question_data: q.question_data });
  const r = await db.collection('generated_questions').updateOne({ _id: q._id as ObjectId }, { $set: set });
  console.log(`적용 ${r.modifiedCount} · 백업 ${backup}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
