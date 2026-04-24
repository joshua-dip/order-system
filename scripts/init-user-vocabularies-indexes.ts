/**
 * user_vocabularies 컬렉션 인덱스 초기 생성 스크립트
 * 실행: npx tsx scripts/init-user-vocabularies-indexes.ts
 */
import { getDb } from '../lib/mongodb';
import { USER_VOCABULARIES_COLLECTION } from '../lib/vocabulary-library-types';

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection(USER_VOCABULARIES_COLLECTION);

  // 동일 유저가 동일 지문을 활성 사본으로 중복 보유 불가 (소프트 딜리트된 것은 허용)
  await col.createIndex(
    { user_id: 1, passage_id: 1 },
    {
      unique: true,
      partialFilterExpression: { deleted_at: null },
      name: 'user_passage_unique_active',
    },
  );

  // 내 단어장 최근 편집순 조회
  await col.createIndex(
    { user_id: 1, last_edited_at: -1 },
    { name: 'user_last_edited' },
  );

  // 교재별 필터링
  await col.createIndex(
    { user_id: 1, textbook: 1 },
    { name: 'user_textbook' },
  );

  // 로그인 ID 보조 (관리자 조회용)
  await col.createIndex(
    { login_id: 1 },
    { name: 'login_id' },
  );

  console.log('user_vocabularies 인덱스 생성 완료');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
