import { getDb } from '@/lib/mongodb';
import {
  MEMBERSHIP_APPLICATIONS_COLLECTION,
  MEMBERSHIP_APPLICATION_RETENTION_DAYS,
} from '@/lib/membership-applications-store';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection(MEMBERSHIP_APPLICATIONS_COLLECTION);

  await col.createIndex({ status: 1, appliedAt: -1 }, { name: 'status_appliedAt' });
  await col.createIndex({ phone: 1, appliedAt: -1 }, { name: 'phone_appliedAt' });
  await col.createIndex({ ip: 1, appliedAt: -1 }, { name: 'ip_appliedAt' });

  // 개인정보 보유 정책: 신청일로부터 N일(현재 90일) 후 자동 파기 (MongoDB TTL).
  // 기존에 expireAfterSeconds 없이 만들어진 동일 keyPattern 인덱스가 있다면 별도 이름이라 충돌 가능 — 에러 메시지 안내.
  try {
    await col.createIndex(
      { appliedAt: 1 },
      {
        name: 'appliedAt_ttl_90d',
        expireAfterSeconds: MEMBERSHIP_APPLICATION_RETENTION_DAYS * 24 * 60 * 60,
      },
    );
  } catch (err) {
    console.warn(
      '[init-membership-applications-indexes] TTL 인덱스 생성 실패 — 기존 인덱스와 충돌 가능. 기존 appliedAt 인덱스를 dropIndex 후 재생성하세요.',
      err,
    );
  }

  console.log('membership_applications 인덱스 생성 완료');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
