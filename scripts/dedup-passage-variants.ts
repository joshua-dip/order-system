/**
 * 한 지문(passage_id)에서 유형별로 처음 N개(기본 3, _id 오름차순)만 남기고
 * 나머지(중복 저장분)를 삭제. cc:variant save 중복 실행 정리용.
 * 사용: tsx scripts/dedup-passage-variants.ts <passage_id> [--keep 3] [--apply]
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

async function main() {
  const pid = process.argv[2];
  if (!pid || !ObjectId.isValid(pid)) { console.error('passage_id 필요'); process.exit(1); }
  const keep = Number((process.argv.find((a) => a.startsWith('--keep='))?.split('=')[1]) || 3);
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');
  const docs = await db.collection('generated_questions')
    .find({ passage_id: new ObjectId(pid) }).project({ _id: 1, type: 1, created_at: 1 }).sort({ _id: 1 }).toArray();

  const byType = new Map<string, ObjectId[]>();
  for (const d of docs) {
    const t = String(d.type);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(d._id as ObjectId);
  }
  const toDelete: ObjectId[] = [];
  for (const [t, ids] of byType) {
    const extra = ids.slice(keep);
    console.log(`${t}: 총 ${ids.length}건 → 유지 ${Math.min(keep, ids.length)} / 삭제 ${extra.length}`);
    toDelete.push(...extra);
  }
  console.log(`\n삭제 대상 합계: ${toDelete.length}건`);
  if (!apply) { console.log('[dry-run] --apply 로 실제 삭제'); process.exit(0); }
  if (toDelete.length) {
    const r = await db.collection('generated_questions').deleteMany({ _id: { $in: toDelete } });
    console.log(`삭제 완료: ${r.deletedCount}건`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
