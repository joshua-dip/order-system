/**
 * generated_questions 에 전역 고유 일련번호(serialNo) 백필.
 * - created_at → _id 순(오래된 것부터)으로 1..N 부여
 * - 이미 serialNo 가 있으면 건너뜀 (idempotent · 재실행 안전)
 * - 시작 번호 = 현재 max(serialNo)+1 → 중단 후 재실행해도 중복 없음
 * - 완료 후 counters['generated_questions_serial'].seq 를 max 로 맞춤 + {serialNo:1} sparse-unique 인덱스
 *
 * 사용:  npx tsx scripts/backfill-generated-serial.ts            # dry-run (계획만)
 *        npx tsx scripts/backfill-generated-serial.ts --execute  # 실제 적용
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import { getDb } from '../lib/mongodb';
import { GENERATED_SERIAL_COUNTER_ID } from '../lib/generated-question-serial';
import type { AnyBulkWriteOperation, ObjectId } from 'mongodb';

const EXECUTE = process.argv.includes('--execute');
const BATCH = 2000;

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const total = await col.countDocuments();
  const numbered = await col.countDocuments({ serialNo: { $exists: true } });
  const toDo = await col.countDocuments({ serialNo: { $exists: false } });
  const maxDoc = await col.find({ serialNo: { $exists: true } }).sort({ serialNo: -1 }).limit(1).project({ serialNo: 1 }).next();
  const startAt = ((maxDoc?.serialNo as number | undefined) ?? 0) + 1;

  console.log(`총 ${total} | 이미 부여 ${numbered} | 부여 대상 ${toDo}`);
  console.log(`시작 번호: V-${String(startAt).padStart(6, '0')} (max+1)`);

  if (!EXECUTE) {
    console.log('\n[DRY-RUN] 실제 적용하려면 --execute 플래그를 붙이세요.');
    process.exit(0);
  }
  if (toDo === 0) {
    console.log('부여할 문항이 없습니다.');
  } else {
    const cursor = col.find({ serialNo: { $exists: false } }, { projection: { _id: 1 } }).sort({ created_at: 1, _id: 1 });
    let next = startAt;
    let ops: AnyBulkWriteOperation[] = [];
    let processed = 0;
    for await (const d of cursor) {
      ops.push({ updateOne: { filter: { _id: d._id as ObjectId }, update: { $set: { serialNo: next } } } });
      next += 1;
      if (ops.length >= BATCH) {
        await col.bulkWrite(ops, { ordered: false });
        // 매 배치마다 counter 를 현재까지 최대치로 올려둠(동시 insert 대비)
        await db.collection('counters').updateOne(
          { _id: GENERATED_SERIAL_COUNTER_ID as unknown as ObjectId },
          { $max: { seq: next - 1 } },
          { upsert: true },
        );
        processed += ops.length;
        ops = [];
        if (processed % 20000 === 0) console.log(`  …${processed}/${toDo} 부여`);
      }
    }
    if (ops.length) {
      await col.bulkWrite(ops, { ordered: false });
      processed += ops.length;
    }
    await db.collection('counters').updateOne(
      { _id: GENERATED_SERIAL_COUNTER_ID as unknown as ObjectId },
      { $max: { seq: next - 1 } },
      { upsert: true },
    );
    console.log(`부여 완료: ${processed}건 (마지막 V-${String(next - 1).padStart(6, '0')})`);
  }

  // sparse-unique 인덱스 (없을 때만)
  await col.createIndex({ serialNo: 1 }, { unique: true, sparse: true, name: 'serialNo_unique' });
  console.log('인덱스 serialNo_unique 보장 완료');

  const finalCounter = await db.collection('counters').findOne({ _id: GENERATED_SERIAL_COUNTER_ID as unknown as ObjectId });
  console.log('counter seq =', (finalCounter as { seq?: number } | null)?.seq);
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
