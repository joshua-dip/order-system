/**
 * 공유자료 store — MongoDB 백엔드.
 *
 * 컬렉션: shared_resource_links
 * 자료 본체는 외부 블로그에 두고, 여기서는 (제목, 부제, URL, 순서) 만 관리.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { SharedResourceLink } from './shared-resources-shared';

export type { SharedResourceLink } from './shared-resources-shared';

const COL = 'shared_resource_links';

interface SharedResourceDoc {
  _id?: ObjectId;
  title: string;
  subtitle?: string;
  blogUrl: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

function toClient(doc: SharedResourceDoc & { _id: ObjectId }): SharedResourceLink {
  return {
    _id: String(doc._id),
    title: doc.title ?? '',
    subtitle: doc.subtitle,
    blogUrl: doc.blogUrl ?? '',
    order: Number(doc.order ?? 0),
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : '',
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : '',
  };
}

export async function listSharedResources(): Promise<SharedResourceLink[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<SharedResourceDoc>(COL)
    .find({})
    .sort({ order: 1, createdAt: -1 })
    .toArray();
  return docs.map(d => toClient(d as SharedResourceDoc & { _id: ObjectId }));
}

export async function createSharedResource(payload: {
  title: string;
  subtitle?: string;
  blogUrl: string;
}): Promise<string> {
  const db = await getDb('gomijoshua');
  const last = await db
    .collection<SharedResourceDoc>(COL)
    .findOne({}, { sort: { order: -1 } });
  const order = last ? Number(last.order ?? 0) + 1 : 0;

  const now = new Date();
  const result = await db.collection<SharedResourceDoc>(COL).insertOne({
    title: payload.title.trim(),
    subtitle: payload.subtitle?.trim() || undefined,
    blogUrl: payload.blogUrl.trim(),
    order,
    createdAt: now,
    updatedAt: now,
  });
  return String(result.insertedId);
}

export async function updateSharedResource(
  id: string,
  payload: Partial<{ title: string; subtitle: string; blogUrl: string; order: number }>,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof payload.title === 'string') set.title = payload.title.trim();
  if (typeof payload.subtitle === 'string') set.subtitle = payload.subtitle.trim() || undefined;
  if (typeof payload.blogUrl === 'string') set.blogUrl = payload.blogUrl.trim();
  if (typeof payload.order === 'number' && Number.isFinite(payload.order)) set.order = payload.order;

  const result = await db.collection<SharedResourceDoc>(COL).updateOne({ _id: oid }, { $set: set });
  return result.matchedCount > 0;
}

export async function deleteSharedResource(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }
  const result = await db.collection<SharedResourceDoc>(COL).deleteOne({ _id: oid });
  return result.deletedCount > 0;
}

/** 인접 항목과 order 교환. direction: 'up' = 위로, 'down' = 아래로 */
export async function moveSharedResourceOrder(id: string, direction: 'up' | 'down'): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const current = await db.collection<SharedResourceDoc>(COL).findOne({ _id: oid });
  if (!current) return false;
  const currentOrder = Number(current.order ?? 0);

  const neighbor = await db.collection<SharedResourceDoc>(COL).findOne(
    { order: direction === 'up' ? { $lt: currentOrder } : { $gt: currentOrder } },
    { sort: { order: direction === 'up' ? -1 : 1 } },
  );
  if (!neighbor) return false;
  const neighborOrder = Number(neighbor.order ?? 0);

  const now = new Date();
  await db.collection<SharedResourceDoc>(COL).updateOne(
    { _id: oid },
    { $set: { order: neighborOrder, updatedAt: now } },
  );
  await db.collection<SharedResourceDoc>(COL).updateOne(
    { _id: neighbor._id! },
    { $set: { order: currentOrder, updatedAt: now } },
  );
  return true;
}
