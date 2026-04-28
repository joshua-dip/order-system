import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  BlockWorkbookSelection,
  WorkbookKind,
} from './block-workbook-types';

const COL = 'block_workbooks';

export interface BlockWorkbookDb {
  _id?: ObjectId;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder: string;
  selection: BlockWorkbookSelection;
  types: WorkbookKind[];
  html: Partial<Record<WorkbookKind, string>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlockWorkbookListItem {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  folder: string;
  types: WorkbookKind[];
  createdAt: string;
  updatedAt: string;
}

export interface BlockWorkbookFull {
  _id: string;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder: string;
  selection: BlockWorkbookSelection;
  types: WorkbookKind[];
  html: Partial<Record<WorkbookKind, string>>;
  createdAt: string;
  updatedAt: string;
}

export async function listBlockWorkbooks(): Promise<BlockWorkbookListItem[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(COL)
    .find({})
    .project({ title: 1, textbook: 1, sourceKey: 1, folder: 1, types: 1, createdAt: 1, updatedAt: 1 })
    .sort({ folder: 1, createdAt: -1 })
    .limit(500)
    .toArray();

  return docs.map(d => ({
    _id: String(d._id),
    title: String(d.title ?? ''),
    textbook: String(d.textbook ?? ''),
    sourceKey: String(d.sourceKey ?? ''),
    folder: String(d.folder ?? '기본'),
    types: Array.isArray(d.types) ? (d.types as WorkbookKind[]) : [],
    createdAt: d.createdAt ? new Date(d.createdAt as Date).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt as Date).toISOString() : '',
  }));
}

export async function getBlockWorkbook(id: string): Promise<BlockWorkbookFull | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const doc = await db.collection(COL).findOne({ _id: oid });
  if (!doc) return null;

  const d = doc as unknown as BlockWorkbookDb & { _id: ObjectId };
  return {
    _id: String(d._id),
    passageId: d.passageId,
    textbook: d.textbook,
    sourceKey: d.sourceKey,
    title: d.title,
    folder: d.folder ?? '기본',
    selection: d.selection,
    types: d.types ?? [],
    html: d.html ?? {},
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : '',
  };
}

export async function saveBlockWorkbook(
  payload: Omit<BlockWorkbookDb, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const db = await getDb('gomijoshua');
  const now = new Date();
  const r = await db.collection(COL).insertOne({ ...payload, createdAt: now, updatedAt: now });
  return String(r.insertedId);
}

export async function deleteBlockWorkbook(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const r = await db.collection(COL).deleteOne({ _id: oid });
  return r.deletedCount > 0;
}
