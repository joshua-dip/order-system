#!/usr/bin/env node
/**
 * 관리자 계정 시드: admin / 123456
 * 실행: npm run seed:admin (프로젝트 루트에서, .env.local에 MONGODB_URI 필요)
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

    const existing = await users.findOne({ loginId: 'admin' });
    if (existing) {
      console.log('admin 계정이 이미 존재합니다.');
      return;
    }

    const passwordHash = await bcrypt.hash('123456', 10);
    await users.createIndex({ loginId: 1 }, { unique: true });
    await users.insertOne({
      loginId: 'admin',
      passwordHash,
      role: 'admin',
      createdAt: new Date(),
    });
    console.log('admin 계정이 생성되었습니다. (비밀번호: 123456)');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
