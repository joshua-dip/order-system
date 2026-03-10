#!/usr/bin/env node
/**
 * 관리자 계정 시드 (환경 변수 사용, 코드에 비밀번호 노출 없음)
 *
 * 필요 환경 변수 (.env.local):
 *   MONGODB_URI           - MongoDB 연결 문자열
 *   ADMIN_LOGIN_ID       - 관리자 로그인 아이디 (예: admin)
 *   ADMIN_INITIAL_PASSWORD - 관리자 초기 비밀번호 (최초 1회만 사용, 생성 후 반드시 변경 권장)
 *
 * 실행: npm run seed:admin (프로젝트 루트에서)
 */
require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_LOGIN_ID = process.env.ADMIN_LOGIN_ID || '';
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || '';

if (!MONGODB_URI) {
  console.error('MONGODB_URI 환경 변수를 설정해주세요.');
  process.exit(1);
}

if (!ADMIN_LOGIN_ID.trim()) {
  console.error('ADMIN_LOGIN_ID 환경 변수를 설정해주세요. (예: admin)');
  process.exit(1);
}

if (!ADMIN_INITIAL_PASSWORD) {
  console.error('ADMIN_INITIAL_PASSWORD 환경 변수를 설정해주세요. (시드 후 비밀번호 변경 권장)');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db('gomijoshua');
    const users = db.collection('users');

    const existing = await users.findOne({ loginId: ADMIN_LOGIN_ID.trim() });
    if (existing) {
      console.log(`계정 '${ADMIN_LOGIN_ID}'이(가) 이미 존재합니다.`);
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 10);
    await users.createIndex({ loginId: 1 }, { unique: true });
    await users.insertOne({
      loginId: ADMIN_LOGIN_ID.trim(),
      passwordHash,
      role: 'admin',
      createdAt: new Date(),
    });
    console.log(`관리자 계정 '${ADMIN_LOGIN_ID}'이(가) 생성되었습니다. 로그인 후 비밀번호 변경을 권장합니다.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
