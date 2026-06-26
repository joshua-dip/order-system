/**
 * 일회성 정리: UV-20260625-001 주제-고난도 중복 제거.
 * cc:variant save 를 실수로 두 번 실행해 동일 문항이 2벌씩(48건) 들어간 것을
 * 콘텐츠 키(셔플 불변: passage_id + Question + 정렬된 보기 텍스트) 기준으로 1벌만 남기고 삭제.
 *   npx tsx scripts/dedup-uv-subject-20260625.ts            # dry-run
 *   npx tsx scripts/dedup-uv-subject-20260625.ts --apply    # 실제 삭제
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadCliEnv(path.resolve(__dirname, '..'));

const PASSAGE_IDS = [
  '69c2dd9846f58f933b6dccf5', '69c2dd9846f58f933b6dccfd', '69c2dd9846f58f933b6dcd02',
  '69c4ffc446f58f933b6dce94', '69c4ffc446f58f933b6dcea6', '69e32fc772a886137cd84add',
  '69e3aded72a886137cd84d96', '69e3adef72a886137cd84e41', '69e3adef72a886137cd84e48',
  '69e3adef72a886137cd84e57', '69e3adef72a886137cd84e61', '69e3adf072a886137cd84ed2',
];

const stripCirc = (o: string) => o.replace(/^[①②③④⑤]\s*/, '').trim();

function contentKey(doc: Record<string, unknown>): string {
  const qd = (doc.question_data ?? {}) as Record<string, unknown>;
  const opts = String(qd.Options ?? '')
    .split(/\s*###\s*/)
    .map(stripCirc)
    .sort();
  return JSON.stringify([String(doc.passage_id), String(qd.Question ?? ''), opts]);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');
  const ids = PASSAGE_IDS.map((s) => new ObjectId(s));
  const coll = db.collection('generated_questions');
  const docs = await coll
    .find({ type: '주제-고난도', passage_id: { $in: ids } })
    .toArray();
  console.log('found 주제-고난도 docs for these 12 passages:', docs.length);

  const groups = new Map<string, Record<string, unknown>[]>();
  for (const d of docs) {
    const k = contentKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }
  console.log('distinct content keys (expected 24):', groups.size);

  const toDelete: ObjectId[] = [];
  for (const arr of groups.values()) {
    if (arr.length > 1) {
      arr.sort((a, b) => String(a._id).localeCompare(String(b._id))); // keep smallest _id
      for (const d of arr.slice(1)) toDelete.push(d._id as ObjectId);
    }
  }
  console.log('duplicate docs to delete:', toDelete.length);

  if (!apply) {
    console.log('DRY RUN — re-run with --apply to delete.');
    return;
  }
  if (toDelete.length) {
    const r = await coll.deleteMany({ _id: { $in: toDelete } });
    console.log('deleted:', r.deletedCount);
  }
  const remaining = await coll.countDocuments({ type: '주제-고난도', passage_id: { $in: ids } });
  console.log('remaining 주제-고난도 for these passages (expected 24):', remaining);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
