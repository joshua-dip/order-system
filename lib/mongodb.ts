import { MongoClient, Db } from 'mongodb';

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  const u = process.env.MONGODB_URI;
  if (!u) throw new Error('MONGODB_URI 환경 변수를 설정해주세요 (.env.local)');
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      global._mongoClientPromise = new MongoClient(u).connect();
    }
    return global._mongoClientPromise;
  }
  return new MongoClient(u).connect();
}

let clientPromise: Promise<MongoClient> | undefined;

export async function getDb(dbName: string = 'gomijoshua'): Promise<Db> {
  if (!clientPromise) clientPromise = getClientPromise();
  const client = await clientPromise;
  return client.db(dbName);
}
