import { getDb } from '@/lib/mongodb';
import { MEMBERSHIP_APPLICATIONS_COLLECTION } from '@/lib/membership-applications-store';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection(MEMBERSHIP_APPLICATIONS_COLLECTION);

  await col.createIndex({ status: 1, appliedAt: -1 }, { name: 'status_appliedAt' });
  await col.createIndex({ phone: 1, appliedAt: -1 }, { name: 'phone_appliedAt' });
  await col.createIndex({ ip: 1, appliedAt: -1 }, { name: 'ip_appliedAt' });

  console.log('membership_applications 인덱스 생성 완료');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
