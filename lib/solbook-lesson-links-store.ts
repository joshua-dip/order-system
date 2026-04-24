import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export const SOLBOOK_LESSON_LINKS_COLLECTION = 'solbook_lesson_links';

export type SolbookLessonLink = {
  lessonKey: string;    // "Lesson 1" 등
  url: string;          // https://solvook.com/products/...
  label?: string;       // "[395문항]" 등 보조 라벨
  itemCount?: number;   // 395
  order?: number;       // 표시 순서
};

export type SolbookLessonLinksDoc = {
  _id?: ObjectId;
  textbookKey: string;
  groupTitle?: string;   // "영어I_NE능률오선영_변형문제_강별"
  groupUrl?: string;     // 전체 강 모음 페이지 (블로그·랜딩)
  groupLabel?: string;   // 모음 링크 라벨
  lessons: SolbookLessonLink[];
  updatedAt: Date;
  updatedBy?: string;
};

/** API 응답용(직렬화) */
export type SolbookLessonLinksSerialized = Omit<SolbookLessonLinksDoc, '_id'> & { id: string };

/** textbookKey → 정보 맵 (공개 API용) */
export type SolbookLessonLinksMap = Record<
  string,
  { groupTitle?: string; groupUrl?: string; groupLabel?: string; lessons: SolbookLessonLink[] }
>;

function toSerialized(doc: SolbookLessonLinksDoc & { _id: ObjectId }): SolbookLessonLinksSerialized {
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function sortLessons(lessons: SolbookLessonLink[]): SolbookLessonLink[] {
  return [...lessons].sort((a, b) => {
    const oa = a.order ?? 999;
    const ob = b.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.lessonKey.localeCompare(b.lessonKey, 'ko');
  });
}

export async function getSolbookLinksMap(): Promise<SolbookLessonLinksMap> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<SolbookLessonLinksDoc>(SOLBOOK_LESSON_LINKS_COLLECTION)
    .find({})
    .toArray();

  const map: SolbookLessonLinksMap = {};
  for (const doc of docs) {
    const key = doc.textbookKey;
    if (!key) continue;
    map[key] = {
      groupTitle: doc.groupTitle,
      groupUrl: doc.groupUrl,
      groupLabel: doc.groupLabel,
      lessons: sortLessons(doc.lessons ?? []),
    };
  }
  return map;
}

export async function getSolbookLinksFor(textbookKey: string): Promise<SolbookLessonLinksSerialized | null> {
  const db = await getDb('gomijoshua');
  const doc = await db
    .collection<SolbookLessonLinksDoc>(SOLBOOK_LESSON_LINKS_COLLECTION)
    .findOne({ textbookKey });
  if (!doc) return null;
  const typed = doc as SolbookLessonLinksDoc & { _id: ObjectId };
  return toSerialized({ ...typed, lessons: sortLessons(typed.lessons ?? []) });
}

export async function listSolbookLinks(): Promise<SolbookLessonLinksSerialized[]> {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<SolbookLessonLinksDoc>(SOLBOOK_LESSON_LINKS_COLLECTION)
    .find({})
    .sort({ textbookKey: 1 })
    .toArray();
  return docs.map((doc) => {
    const typed = doc as SolbookLessonLinksDoc & { _id: ObjectId };
    return toSerialized({ ...typed, lessons: sortLessons(typed.lessons ?? []) });
  });
}

export type UpsertSolbookLinksPayload = {
  groupTitle?: string;
  groupUrl?: string;
  groupLabel?: string;
  lessons: SolbookLessonLink[];
  updatedBy?: string;
};

export async function upsertSolbookLinks(
  textbookKey: string,
  payload: UpsertSolbookLinksPayload,
): Promise<SolbookLessonLinksSerialized> {
  const db = await getDb('gomijoshua');
  const col = db.collection<SolbookLessonLinksDoc>(SOLBOOK_LESSON_LINKS_COLLECTION);
  const now = new Date();

  const setData: Omit<SolbookLessonLinksDoc, '_id'> = {
    textbookKey,
    lessons: payload.lessons,
    updatedAt: now,
    ...(payload.groupTitle !== undefined ? { groupTitle: payload.groupTitle } : {}),
    ...(payload.groupUrl !== undefined ? { groupUrl: payload.groupUrl } : {}),
    ...(payload.groupLabel !== undefined ? { groupLabel: payload.groupLabel } : {}),
    ...(payload.updatedBy ? { updatedBy: payload.updatedBy } : {}),
  };

  const result = await col.findOneAndUpdate(
    { textbookKey },
    { $set: setData },
    { upsert: true, returnDocument: 'after' },
  );

  const updated = result as (SolbookLessonLinksDoc & { _id: ObjectId }) | null;
  if (!updated) throw new Error('upsert 실패');
  return toSerialized({ ...updated, lessons: sortLessons(updated.lessons ?? []) });
}

export async function deleteSolbookLinks(textbookKey: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  const result = await db
    .collection(SOLBOOK_LESSON_LINKS_COLLECTION)
    .deleteOne({ textbookKey });
  return result.deletedCount > 0;
}
