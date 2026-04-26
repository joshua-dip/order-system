import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const COL = 'essay_exams';

export interface EssayExamDoc {
  _id?: ObjectId;
  title: string;
  textbook: string;
  sourceKey: string;
  /** 원본 passage 의 ObjectId (선택). 있으면 sourceKey 변경에도 역참조 가능. */
  passageId?: string;
  difficulty: string;
  folder: string;   // 폴더 이름 (기본: '기본')
  order: number;    // 폴더 내 정렬 순서 (작을수록 앞)
  /** 폴더 생성을 위한 더미 문서 — 목록에 표시하지 않음 */
  isPlaceholder?: boolean;
  data: object;
  html: string;
  createdAt: Date;
  updatedAt: Date;
}

/** MongoDB 문서를 API/클라이언트로 넘길 때 hex 문자열 _id */
export type EssayExamDocWithStringId = Omit<EssayExamDoc, '_id'> & { _id: string };

export interface EssayExamListItem {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  folder: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export async function listEssayExams(): Promise<EssayExamListItem[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(COL)
    .find({
      isPlaceholder: { $ne: true },   // 폴더 더미 문서 제외
      $nor: [{ textbook: '', sourceKey: '', title: /^\[.*\] 폴더$/ }],  // 구버전 더미 문서도 제외
    })
    .project({ title: 1, textbook: 1, sourceKey: 1, difficulty: 1, folder: 1, order: 1, createdAt: 1, updatedAt: 1 })
    .sort({ folder: 1, order: 1, createdAt: 1 })
    .limit(500)
    .toArray();

  return docs.map(d => ({
    _id: String(d._id),
    title: String(d.title ?? ''),
    textbook: String(d.textbook ?? ''),
    sourceKey: String(d.sourceKey ?? ''),
    difficulty: String(d.difficulty ?? ''),
    folder: String(d.folder ?? '기본'),
    order: Number(d.order ?? 0),
    createdAt: d.createdAt ? new Date(d.createdAt as Date).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt as Date).toISOString() : '',
  }));
}

export async function listFolders(): Promise<string[]> {
  const db = await getDb('gomijoshua');
  const folders = await db.collection(COL).distinct('folder');
  const result = (folders as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  if (!result.includes('기본')) result.unshift('기본');
  return result;
}

export async function getEssayExam(id: string): Promise<EssayExamDocWithStringId | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const doc = await db.collection(COL).findOne({ _id: oid });
  if (!doc) return null;
  const { _id: _mongoId, ...rest } = doc as unknown as EssayExamDoc & { _id: ObjectId };
  return { ...rest, _id: String(_mongoId) };
}

export async function listExamsByFolder(folder: string): Promise<EssayExamDocWithStringId[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(COL)
    .find({ folder })
    .sort({ order: 1, createdAt: 1 })
    .toArray();
  return docs.map(d => {
    const { _id: _mongoId, ...rest } = d as unknown as EssayExamDoc & { _id: ObjectId };
    return { ...rest, _id: String(_mongoId) };
  });
}

export async function saveEssayExam(
  payload: Omit<EssayExamDoc, '_id' | 'createdAt' | 'updatedAt' | 'order'>,
): Promise<string> {
  const db = await getDb('gomijoshua');
  // 폴더 내 마지막 order + 1
  const last = await db
    .collection(COL)
    .findOne({ folder: payload.folder }, { sort: { order: -1 } });
  const order = last ? (Number((last as { order?: number }).order ?? 0) + 1) : 0;

  const now = new Date();
  const result = await db.collection(COL).insertOne({ ...payload, order, createdAt: now, updatedAt: now });
  return String(result.insertedId);
}

export async function updateEssayExam(
  id: string,
  payload: Partial<Omit<EssayExamDoc, '_id' | 'createdAt'>>,
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

export async function moveExamOrder(id: string, direction: 'up' | 'down'): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const current = await db.collection(COL).findOne({ _id: oid });
  if (!current) return false;

  const folder = String((current as { folder?: string }).folder ?? '기본');
  const currentOrder = Number((current as { order?: number }).order ?? 0);

  const neighbor = await db.collection(COL).findOne(
    { folder, order: direction === 'up' ? { $lt: currentOrder } : { $gt: currentOrder } },
    { sort: { order: direction === 'up' ? -1 : 1 } },
  );
  if (!neighbor) return false;

  const neighborOrder = Number((neighbor as { order?: number }).order ?? 0);
  await db.collection(COL).updateOne({ _id: oid }, { $set: { order: neighborOrder, updatedAt: new Date() } });
  await db.collection(COL).updateOne({ _id: neighbor._id }, { $set: { order: currentOrder, updatedAt: new Date() } });
  return true;
}

export async function deleteEssayExam(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const result = await db.collection(COL).deleteOne({ _id: oid });
  return result.deletedCount > 0;
}
