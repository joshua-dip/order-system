/**
 * 국어 해설지(`korean_explanations`) 스토어 — MongoDB CRUD.
 *
 * essay-exams-store 와 동일 컨벤션. 컬렉션은 영어 자산과 격리.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { Block } from '@/lib/korean-explainer/types';

const COL = 'korean_explanations';

export interface KoreanExplanationDoc {
  _id?: ObjectId;
  /** 국어 원문(`korean_passages`) 참조 — 후속 PR 에서 도입. 1차에는 비어 있을 수 있음. */
  passageId?: string;
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  showSubtitle?: boolean;
  blocks: Block[];
  /** 상태 — 1차에는 admin 작성 즉시 검수완료. */
  status: '대기' | '검수완료' | '검수불일치';
  folder: string;          // 폴더 이름 (기본: '기본')
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;      // 'admin:web' | 'cc:korean-explain' | loginId
}

export type KoreanExplanationDocWithStringId = Omit<KoreanExplanationDoc, '_id'> & { _id: string };

export interface KoreanExplanationListItem {
  _id: string;
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  status: KoreanExplanationDoc['status'];
  folder: string;
  blockCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── 조회 ──────────────────────────────────────────────────────────────────────

export async function listKoreanExplanations(filter: { textbook?: string; folder?: string } = {}): Promise<KoreanExplanationListItem[]> {
  const db = await getDb('gomijoshua');
  const query: Record<string, unknown> = {};
  if (filter.textbook) query.textbook = filter.textbook;
  if (filter.folder) query.folder = filter.folder;

  const docs = await db
    .collection(COL)
    .find(query)
    .project({ textbook: 1, sourceKey: 1, setRange: 1, genre: 1, workTitle: 1, examTitle: 1, status: 1, folder: 1, blocks: 1, createdAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(500)
    .toArray();

  return docs.map(d => ({
    _id: String(d._id),
    textbook: String(d.textbook ?? ''),
    sourceKey: String(d.sourceKey ?? ''),
    setRange: String(d.setRange ?? ''),
    genre: String(d.genre ?? ''),
    workTitle: String(d.workTitle ?? ''),
    examTitle: String(d.examTitle ?? ''),
    status: (d.status as KoreanExplanationDoc['status']) ?? '검수완료',
    folder: String(d.folder ?? '기본'),
    blockCount: Array.isArray(d.blocks) ? d.blocks.length : 0,
    createdAt: d.createdAt ? new Date(d.createdAt as Date).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt as Date).toISOString() : '',
  }));
}

export async function getKoreanExplanation(id: string): Promise<KoreanExplanationDocWithStringId | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const doc = await db.collection(COL).findOne({ _id: oid });
  if (!doc) return null;
  const { _id: _mongoId, ...rest } = doc as unknown as KoreanExplanationDoc & { _id: ObjectId };
  return { ...rest, _id: String(_mongoId) };
}

export async function listFolders(): Promise<string[]> {
  const db = await getDb('gomijoshua');
  const folders = await db.collection(COL).distinct('folder');
  const result = (folders as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  if (!result.includes('기본')) result.unshift('기본');
  return result;
}

export async function listTextbooks(): Promise<string[]> {
  const db = await getDb('gomijoshua');
  const arr = await db.collection(COL).distinct('textbook');
  return (arr as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}

// ── 변경 ──────────────────────────────────────────────────────────────────────

export async function saveKoreanExplanation(
  payload: Omit<KoreanExplanationDoc, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const db = await getDb('gomijoshua');
  const now = new Date();
  const result = await db.collection(COL).insertOne({
    ...payload,
    status: payload.status ?? '검수완료',
    folder: payload.folder || '기본',
    createdAt: now,
    updatedAt: now,
  });
  return String(result.insertedId);
}

export async function updateKoreanExplanation(
  id: string,
  payload: Partial<Omit<KoreanExplanationDoc, '_id' | 'createdAt'>>,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const result = await db.collection(COL).updateOne(
    { _id: oid },
    { $set: { ...payload, updatedAt: new Date() } },
  );
  return result.matchedCount > 0;
}

export async function deleteKoreanExplanation(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const result = await db.collection(COL).deleteOne({ _id: oid });
  return result.deletedCount > 0;
}
