#!/usr/bin/env node
/**
 * 테스트 사용자 계정 시드: test / 123456 (role: user)
 * 실행: npm run seed:testuser (프로젝트 루트에서, .env.local에 MONGODB_URI 필요)
 */
require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI 환경 변수를 설정해주세요.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db('gomijoshua');
    const users = db.collection('users');

    const existing = await users.findOne({ loginId: 'test' });
    if (existing) {
      console.log('test 계정이 이미 존재합니다.');
      return;
    }

    const passwordHash = await bcrypt.hash('123456', 10);
    try {
      await users.createIndex({ loginId: 1 }, { unique: true });
    } catch (_) {}
    await users.insertOne({
      loginId: 'test',
      passwordHash,
      role: 'user',
      createdAt: new Date(),
    });
    console.log('테스트 사용자 계정이 생성되었습니다.');
    console.log('  아이디: test');
    console.log('  비밀번호: 123456');
    console.log('  → /login 에서 로그인 테스트 가능');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
