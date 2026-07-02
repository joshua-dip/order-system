import { MongoClient, Db, type MongoClientOptions } from 'mongodb';

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

/**
 * 연결 옵션 — 순단 시 30초(기본) 동안 매달리지 않고 빨리 실패해 재시도로 넘어가게.
 * maxPoolSize 는 서버리스(Amplify)에서 인스턴스가 늘어날 때 Atlas 연결 한도를 넘지 않게 제한.
 */
const CLIENT_OPTIONS: MongoClientOptions = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
  maxPoolSize: 10,
};

function freshClientPromise(): Promise<MongoClient> {
  const u = process.env.MONGODB_URI;
  if (!u) throw new Error('MONGODB_URI 환경 변수를 설정해주세요 (.env.local)');
  return new MongoClient(u, CLIENT_OPTIONS).connect();
}

function getClientPromise(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = freshClientPromise();
    }
    return global._mongoClientPromise;
  }
  return freshClientPromise();
}

let clientPromise: Promise<MongoClient> | undefined;

function resetCache(): void {
  clientPromise = undefined;
  if (process.env.NODE_ENV === 'development') global._mongoClientPromise = undefined;
}

/**
 * DB 핸들. ⚠️ 연결 promise 가 한 번 실패하면 캐시에 '실패한 promise'가 고착되어
 * 그 인스턴스의 모든 후속 요청이 계속 실패하는 문제(간헐 로그인 풀림)가 있어,
 * 실패 시 캐시를 비우고 1회 재연결한다.
 */
export async function getDb(dbName: string = 'gomijoshua'): Promise<Db> {
  if (!clientPromise) clientPromise = getClientPromise();
  try {
    const client = await clientPromise;
    return client.db(dbName);
  } catch (firstErr) {
    // 오염된 캐시 제거 후 재시도 (연결 순단 회복)
    resetCache();
    try {
      clientPromise = getClientPromise();
      const client = await clientPromise;
      return client.db(dbName);
    } catch (retryErr) {
      resetCache(); // 다음 요청도 신선한 연결을 시도하도록
      console.error('MongoDB 연결 실패(재시도 포함):', firstErr, retryErr);
      throw retryErr;
    }
  }
}
