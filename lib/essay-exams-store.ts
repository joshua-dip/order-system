import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { ESSAY_MEANING_EXAM_TYPE } from '@/app/data/essay-categories';

const COL = 'essay_exams';

/**
 * 유형(examType) 필터 — examType 은 data.meta.examType 에만 저장된다(별도 top-level 없음).
 * - '글의의미서술형': 글의의미만.
 * - 그 외(배열형 등): 글의의미 제외 ($ne 는 examType 누락 레거시 문서도 포함).
 * - 미지정: 전체.
 */
function examTypeMatch(examType?: string): Record<string, unknown> {
  if (!examType) return {};
  if (examType === ESSAY_MEANING_EXAM_TYPE) return { 'data.meta.examType': ESSAY_MEANING_EXAM_TYPE };
  return { 'data.meta.examType': { $ne: ESSAY_MEANING_EXAM_TYPE } };
}

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

/**
 * 저장된 문제 목록.
 *
 * - folder 인자 없음: 전체 (안전상 limit 5000 적용 — 그 이상은 폴더로 필터 후 봐야).
 * - folder 인자 있음: 그 폴더만 — limit 없이 모두 반환. (폴더당 보통 100건 단위)
 */
export async function listEssayExams(options?: { folder?: string; examType?: string }): Promise<EssayExamListItem[]> {
  const db = await getDb('gomijoshua');
  const baseFilter: Record<string, unknown> = {
    isPlaceholder: { $ne: true },
    $nor: [{ textbook: '', sourceKey: '', title: /^\[.*\] 폴더$/ }],
    ...examTypeMatch(options?.examType),
  };
  const filter = options?.folder ? { ...baseFilter, folder: options.folder } : baseFilter;

  let cursor = db
    .collection(COL)
    .find(filter)
    .project({ title: 1, textbook: 1, sourceKey: 1, difficulty: 1, folder: 1, order: 1, createdAt: 1, updatedAt: 1 })
    .sort({ folder: 1, order: 1, createdAt: 1 });
  if (!options?.folder) cursor = cursor.limit(5000);
  const docs = await cursor.toArray();

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

/** 한 교재(모의고사) 의 모든 실문항. payperic 상품 적재용 그룹핑에 쓴다. */
export async function listEssayExamsByTextbook(textbook: string): Promise<EssayExamListItem[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(COL)
    .find({
      textbook,
      isPlaceholder: { $ne: true },
      $nor: [{ textbook: '', sourceKey: '', title: /^\[.*\] 폴더$/ }],
    })
    .project({ title: 1, textbook: 1, sourceKey: 1, difficulty: 1, folder: 1, order: 1, createdAt: 1, updatedAt: 1 })
    .sort({ order: 1, createdAt: 1 })
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

export async function listFolders(examType?: string): Promise<string[]> {
  const db = await getDb('gomijoshua');
  const folders = await db.collection(COL).distinct('folder', examTypeMatch(examType));
  const result = (folders as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  if (!result.includes('기본')) result.unshift('기본');
  return result;
}

/** 폴더별 도큐먼트 수 — 사이드바 카운트용. limit 영향 없이 정확. */
export async function listFolderCounts(examType?: string): Promise<Record<string, number>> {
  const db = await getDb('gomijoshua');
  const pipeline: object[] = [
    {
      $match: {
        isPlaceholder: { $ne: true },
        $nor: [{ textbook: '', sourceKey: '', title: /^\[.*\] 폴더$/ }],
        ...examTypeMatch(examType),
      },
    },
    { $group: { _id: { $ifNull: ['$folder', '기본'] }, count: { $sum: 1 } } },
  ];
  const rows = await db.collection(COL).aggregate(pipeline).toArray();
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[String(r._id)] = Number(r.count ?? 0);
  }
  return out;
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
