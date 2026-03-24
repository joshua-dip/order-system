import path from 'path';
import fs from 'fs/promises';
import { getDb } from '@/lib/mongodb';

/** 병합된 교재 트리(Sheet1 구조)를 보관. 서버리스에서는 로컬 JSON 파일 대신 이 컬렉션을 사용합니다. */
const COLLECTION = 'converted_textbook_json';
const MERGED_KEY = 'merged';

let indexEnsured = false;

async function ensureIndex() {
  if (indexEnsured) return;
  try {
    const db = await getDb('gomijoshua');
    await db.collection(COLLECTION).createIndex({ key: 1 }, { unique: true });
    indexEnsured = true;
  } catch {
    /* ignore */
  }
}

async function readMergedFromFile(): Promise<Record<string, unknown>> {
  try {
    const jsonPath = path.join(process.cwd(), 'app', 'data', 'converted_data.json');
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * 병합 교재 데이터 조회.
 * 1) MongoDB에 비어 있지 않은 merged 문서가 있으면 사용
 * 2) 없으면 저장소의 converted_data.json (로컬/배포 이미지에 포함된 기본값)
 */
export async function readMergedConvertedData(): Promise<Record<string, unknown>> {
  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COLLECTION).findOne<{ data?: unknown }>({ key: MERGED_KEY });
    if (doc?.data && typeof doc.data === 'object' && !Array.isArray(doc.data)) {
      const d = doc.data as Record<string, unknown>;
      if (Object.keys(d).length > 0) return d;
    }
  } catch (e) {
    console.warn('readMergedConvertedData: Mongo 조회 실패, 파일 폴백', e);
  }
  return readMergedFromFile();
}

/** Vercel 등: 배포 인스턴스 디스크에 쓰기 불가·무의미 */
function shouldWriteConvertedDataJsonFile(): boolean {
  if (process.env.CONVERTED_DATA_DISABLE_FILE === '1') return false;
  return process.env.VERCEL !== '1';
}

/**
 * 병합 데이터 저장: 항상 MongoDB upsert.
 * 로컬 등 쓰기 가능한 환경에서는 기존처럼 converted_data.json도 갱신(깃 커밋용).
 */
export async function writeMergedConvertedData(data: Record<string, unknown>): Promise<void> {
  const db = await getDb('gomijoshua');
  await ensureIndex();
  await db.collection(COLLECTION).updateOne(
    { key: MERGED_KEY },
    { $set: { key: MERGED_KEY, data, updatedAt: new Date() } },
    { upsert: true }
  );

  if (!shouldWriteConvertedDataJsonFile()) return;

  try {
    const jsonPath = path.join(process.cwd(), 'app', 'data', 'converted_data.json');
    await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('writeMergedConvertedData: converted_data.json 파일 쓰기 생략/실패', e);
  }
}
