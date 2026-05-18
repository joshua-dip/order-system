/**
 * 일회성: '26년 고3 5월 영어모의고사' 표기를 모든 컬렉션의 chapter / source_key /
 * sourceKey 등에서 '26년 5월 고3 영어모의고사' 로 치환.
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-26-5-chapter-sourcekey.ts --dry-run
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-26-5-chapter-sourcekey.ts
 *
 * 변경 대상:
 *   passages.chapter / passages.source_key
 *   essay_exams.sourceKey
 *   essay_step_workbooks.sourceKey
 *   block_workbooks.sourceKey
 *   generated_questions.source_key (있으면)
 *   narrative_questions.source_key (있으면)
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';

const FROM_FRAG = '26년 고3 5월 영어모의고사';
const TO_FRAG = '26년 5월 고3 영어모의고사';
const DRY = process.argv.includes('--dry-run');

interface ColSpec {
  collection: string;
  fields: string[];     // substring 치환 대상 필드들
  ts?: 'updatedAt' | 'updated_at';
}

const SPEC: ColSpec[] = [
  { collection: 'passages',                fields: ['chapter', 'source_key'], ts: 'updated_at' },
  { collection: 'essay_exams',             fields: ['sourceKey'],             ts: 'updatedAt' },
  { collection: 'essay_step_workbooks',    fields: ['sourceKey'],             ts: 'updatedAt' },
  { collection: 'block_workbooks',         fields: ['sourceKey'],             ts: 'updatedAt' },
  { collection: 'generated_questions',     fields: ['source_key'],            ts: 'updated_at' },
  { collection: 'narrative_questions',     fields: ['source_key'],            ts: 'updated_at' },
  { collection: 'member_generated_questions', fields: ['source_key'],         ts: 'updated_at' },
];

async function main() {
  const db = await getDb('gomijoshua');

  /** 각 컬렉션·필드별 매칭 도큐먼트 카운트 */
  const reportCounts: Record<string, number> = {};
  /** 실 실행 시 변경 카운트 */
  const reportModified: Record<string, number> = {};

  for (const spec of SPEC) {
    for (const field of spec.fields) {
      const filter = { [field]: { $regex: FROM_FRAG } };
      const cnt = await db.collection(spec.collection).countDocuments(filter);
      reportCounts[`${spec.collection}.${field}`] = cnt;
    }
  }

  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, FROM_FRAG, TO_FRAG, counts: reportCounts }, null, 2));
    process.exit(0);
  }

  /** 실 실행 — 도큐먼트 단위로 가져와서 substring replace 후 update.
   *  $regex updateMany 는 단일 정적 값으로만 set 가능해서 도큐먼트별 처리 필요. */
  for (const spec of SPEC) {
    for (const field of spec.fields) {
      const filter = { [field]: { $regex: FROM_FRAG } };
      const cursor = db.collection(spec.collection).find(filter).project({ _id: 1, [field]: 1 });
      let modified = 0;
      for await (const doc of cursor) {
        const oldVal = (doc as Record<string, unknown>)[field];
        if (typeof oldVal !== 'string' || !oldVal.includes(FROM_FRAG)) continue;
        const newVal = oldVal.split(FROM_FRAG).join(TO_FRAG);
        if (newVal === oldVal) continue;
        const set: Record<string, unknown> = { [field]: newVal };
        if (spec.ts) set[spec.ts] = new Date();
        await db.collection(spec.collection).updateOne({ _id: doc._id }, { $set: set });
        modified += 1;
      }
      reportModified[`${spec.collection}.${field}`] = modified;
    }
  }

  console.log(JSON.stringify({ ok: true, FROM_FRAG, TO_FRAG, counts: reportCounts, modified: reportModified }, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
