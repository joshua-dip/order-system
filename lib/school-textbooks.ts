/**
 * 교과서(학교 교과서) 교재 — admin "교과서" 교재 링크 폴더(textbook_link_folders)에 배정된 교재를
 * UnifiedOrder '교과서' 카테고리(권한 계정만)에 노출하기 위한 헬퍼.
 *
 * 교과서 교재는 converted_textbook_json(주문용 병합 데이터)에 없을 수 있어, passages 의
 * chapter/number 로 주문 화면이 기대하는 트리를 즉석에서 만든다(모의고사 enrich 와 동일 방식).
 */
import type { Db } from 'mongodb';
import {
  buildMergedTextbookBranchFromPassages,
  type MergedTextbookBranch,
  type PassageRow,
} from '@/lib/build-converted-branch-from-passages';

const FOLDERS = 'textbook_link_folders';
const ASSIGN = 'textbook_link_folder_assignments';
const SCHOOL_FOLDER_NAME = '교과서';

/** "교과서" 폴더에 배정된 교재 키 목록 (중복 제거). 폴더가 없으면 빈 배열. */
export async function getSchoolTextbookKeys(db: Db): Promise<string[]> {
  const folder = await db.collection(FOLDERS).findOne({ name: SCHOOL_FOLDER_NAME });
  if (!folder) return [];
  const fid = String(folder._id);
  const asg = await db
    .collection(ASSIGN)
    // folderId 는 string 또는 ObjectId 로 저장될 수 있어 둘 다 매칭
    .find({ $or: [{ folderId: fid }, { folderId: folder._id }] })
    .project({ textbookKey: 1 })
    .toArray();
  const keys = asg
    .map((a) => String((a as { textbookKey?: unknown }).textbookKey ?? '').trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

/**
 * 교과서 교재 + passages 기반 트리. passages 가 있는 교재만 포함(주문 가능해야 노출).
 * 반환 data 는 `{ [교재명]: { Sheet1: { 부교재: ... } } }` — UnifiedOrder 의 extractLessonGroups 입력 형태.
 */
export async function buildSchoolTextbooksData(
  db: Db,
): Promise<{ keys: string[]; data: Record<string, MergedTextbookBranch> }> {
  const keys = await getSchoolTextbookKeys(db);
  if (keys.length === 0) return { keys: [], data: {} };

  const data: Record<string, MergedTextbookBranch> = {};
  const outKeys: string[] = [];
  for (const key of keys) {
    const rows = (await db
      .collection('passages')
      .find({ textbook: key })
      .project({ chapter: 1, number: 1, order: 1 })
      .toArray()) as PassageRow[];
    if (rows.length === 0) continue;
    const built = buildMergedTextbookBranchFromPassages(key, rows);
    if (!built) continue;
    data[key] = built.branch;
    outKeys.push(key);
  }
  return { keys: outKeys, data };
}
