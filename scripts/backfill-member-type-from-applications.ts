/**
 * 회원 구분(memberType) 소급 — 가입 신청서로 만든 계정에 신청 유형을 채운다.
 * 계정 생성 때 applicantType 을 버리던 것(2026-09-29 수정)의 과거분 복구.
 *
 *   npx tsx scripts/backfill-member-type-from-applications.ts          # dry-run
 *   npx tsx scripts/backfill-member-type-from-applications.ts --apply  # 백업 후 적용
 *
 * 이미 구분이 있는 계정은 건드리지 않는다(관리자가 직접 고른 값이 우선).
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
config({ quiet: true } as never);
import fs from 'node:fs';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const APPLY = process.argv.includes('--apply');
const TYPES = new Set(['student', 'parent', 'teacher']);

(async () => {
  const db = await getDb('gomijoshua');
  const users = await db
    .collection('users')
    .find({ createdFromApplicationId: { $exists: true, $nin: [null, ''] }, $or: [{ memberType: { $exists: false } }, { memberType: '' }, { memberType: null }] })
    .project({ loginId: 1, name: 1, createdFromApplicationId: 1 })
    .toArray();
  const appIds = users.map((u) => String(u.createdFromApplicationId)).filter((x) => ObjectId.isValid(x));
  const apps = await db
    .collection('membership_applications')
    .find({ _id: { $in: appIds.map((x) => new ObjectId(x)) } })
    .project({ applicantType: 1 })
    .toArray();
  const typeByApp = new Map(apps.map((a) => [String(a._id), String(a.applicantType)]));
  const plan = users
    .map((u) => ({ _id: u._id as ObjectId, type: typeByApp.get(String(u.createdFromApplicationId)) ?? '' }))
    .filter((x) => TYPES.has(x.type));
  const byType: Record<string, number> = {};
  for (const p of plan) byType[p.type] = (byType[p.type] ?? 0) + 1;
  console.log(JSON.stringify({ candidates: users.length, fillable: plan.length, byType }));
  if (!APPLY) return process.exit(0);

  fs.mkdirSync('.tmp', { recursive: true });
  const file = `.tmp/backup-member-type-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(plan.map((p) => ({ _id: String(p._id), memberType: null, setTo: p.type })), null, 1));
  let modified = 0;
  for (const p of plan) {
    const r = await db.collection('users').updateOne(
      { _id: p._id, $or: [{ memberType: { $exists: false } }, { memberType: '' }, { memberType: null }] },
      { $set: { memberType: p.type, memberTypeSource: 'application-backfill' } },
    );
    modified += r.modifiedCount;
  }
  console.log(JSON.stringify({ backup: file, modified }));
  process.exit(0);
})();
