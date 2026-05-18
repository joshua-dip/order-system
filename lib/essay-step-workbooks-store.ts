/**
 * 서술형집중 워크북 — DB 저장소.
 *
 * 콜렉션: essay_step_workbooks
 *   { _id, title, textbook, sourceKey, passageId?, folder, order, data, html, createdAt, updatedAt }
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { EssayStepWorkbookData } from './essay-step-workbook';

export const ESSAY_STEP_COL = 'essay_step_workbooks';

export interface EssayStepWorkbookDoc {
  _id?: ObjectId;
  title: string;
  textbook: string;
  sourceKey: string;
  passageId?: string;
  folder: string;
  order: number;
  data: EssayStepWorkbookData;
  html: string;
  createdAt: Date;
  updatedAt: Date;
}

export type EssayStepWorkbookListItem = {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  folder: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type EssayStepWorkbookFull = Omit<EssayStepWorkbookDoc, '_id'> & { _id: string };

export async function listEssayStepWorkbooks(): Promise<EssayStepWorkbookListItem[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(ESSAY_STEP_COL)
    .find({})
    .project({ title: 1, textbook: 1, sourceKey: 1, folder: 1, order: 1, createdAt: 1, updatedAt: 1 })
    .sort({ folder: 1, order: 1, createdAt: 1 })
    .limit(500)
    .toArray();
  return docs.map(d => ({
    _id: String(d._id),
    title: String(d.title ?? ''),
    textbook: String(d.textbook ?? ''),
    sourceKey: String(d.sourceKey ?? ''),
    folder: String(d.folder ?? '기본'),
    order: Number(d.order ?? 0),
    createdAt: d.createdAt ? new Date(d.createdAt as Date).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt as Date).toISOString() : '',
  }));
}

export async function getEssayStepWorkbook(id: string): Promise<EssayStepWorkbookFull | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }
  const doc = await db.collection(ESSAY_STEP_COL).findOne({ _id: oid });
  if (!doc) return null;
  const { _id: _mongoId, ...rest } = doc as unknown as EssayStepWorkbookDoc & { _id: ObjectId };
  return { ...rest, _id: String(_mongoId) };
}

export async function saveEssayStepWorkbook(
  payload: Omit<EssayStepWorkbookDoc, '_id' | 'createdAt' | 'updatedAt' | 'order'>,
): Promise<string> {
  const db = await getDb('gomijoshua');
  const last = await db
    .collection(ESSAY_STEP_COL)
    .findOne({ folder: payload.folder }, { sort: { order: -1 } });
  const order = last ? (Number((last as { order?: number }).order ?? 0) + 1) : 0;

  const now = new Date();
  const result = await db
    .collection(ESSAY_STEP_COL)
    .insertOne({ ...payload, order, createdAt: now, updatedAt: now });
  return String(result.insertedId);
}

export async function updateEssayStepWorkbook(
  id: string,
  payload: Partial<Omit<EssayStepWorkbookDoc, '_id' | 'createdAt'>>,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const result = await db.collection(ESSAY_STEP_COL).updateOne(
    { _id: oid },
    { $set: { ...payload, updatedAt: new Date() } },
  );
  return result.matchedCount > 0;
}

export async function deleteEssayStepWorkbook(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const result = await db.collection(ESSAY_STEP_COL).deleteOne({ _id: oid });
  return result.deletedCount > 0;
}
