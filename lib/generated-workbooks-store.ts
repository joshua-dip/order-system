import { ObjectId, type Db, type WithId, type Document } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  GENERATED_WORKBOOKS_COLLECTION,
  type GeneratedWorkbookInsert,
  type GeneratedWorkbookDoc,
} from './generated-workbooks-types';
import type { WorkbookGrammarPoint } from './workbook-grammar-types';

function col(db: Db) {
  return db.collection(GENERATED_WORKBOOKS_COLLECTION);
}

async function defaultDb() {
  return getDb('gomijoshua');
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export type SaveWorkbookInput = {
  passage_id: string;
  textbook: string;
  passage_source_label?: string;
  category: '워크북어법';
  paragraph: string;
  grammar_points: WorkbookGrammarPoint[];
  answer_text: string;
  explanation: string;
  truncated_points_count?: number | null;
  created_by?: string;
  parent_id?: string;
  status?: 'draft' | 'reviewed';
};

export type SaveWorkbookResult =
  | { ok: true; inserted_id: string }
  | { ok: false; error: string };

export async function saveGeneratedWorkbook(
  input: SaveWorkbookInput,
  db?: Db,
): Promise<SaveWorkbookResult> {
  const d = db ?? (await defaultDb());
  const passageIdStr = input.passage_id.trim();
  if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
    return { ok: false, error: '유효한 passage_id 가 필요합니다.' };
  }

  const now = new Date();
  const doc: GeneratedWorkbookInsert = {
    passage_id: new ObjectId(passageIdStr),
    textbook: input.textbook.trim(),
    passage_source_label: input.passage_source_label?.trim() || undefined,
    category: input.category,
    paragraph: input.paragraph,
    grammar_points: input.grammar_points,
    answer_text: input.answer_text,
    explanation: input.explanation,
    status: input.status ?? 'draft',
    truncated_points_count: input.truncated_points_count ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    created_by: input.created_by,
    parent_id: input.parent_id && ObjectId.isValid(input.parent_id)
      ? new ObjectId(input.parent_id)
      : undefined,
  };

  const r = await col(d).insertOne(doc);
  return { ok: true, inserted_id: String(r.insertedId) };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function serializeDoc(d: WithId<Document>): Record<string, unknown> {
  const { _id, passage_id, parent_id, legacy_question_id, ...rest } = d;
  return {
    id: String(_id),
    passage_id: passage_id ? String(passage_id) : null,
    parent_id: parent_id ? String(parent_id) : null,
    legacy_question_id: legacy_question_id ? String(legacy_question_id) : null,
    ...rest,
  };
}

export async function findWorkbookById(
  id: string,
  db?: Db,
): Promise<Record<string, unknown> | null> {
  if (!ObjectId.isValid(id)) return null;
  const d = db ?? (await defaultDb());
  const doc = await col(d).findOne({
    _id: new ObjectId(id),
    deleted_at: null,
  });
  return doc ? serializeDoc(doc) : null;
}

export async function findLatestByPassage(
  passageId: string,
  db?: Db,
): Promise<Record<string, unknown> | null> {
  if (!ObjectId.isValid(passageId)) return null;
  const d = db ?? (await defaultDb());
  const doc = await col(d).findOne(
    { passage_id: new ObjectId(passageId), deleted_at: null },
    { sort: { created_at: -1 } },
  );
  return doc ? serializeDoc(doc) : null;
}

// ---------------------------------------------------------------------------
// List — 지문 단위 (passages ⟕ generated_workbooks)
// ---------------------------------------------------------------------------

export type WorkbookListParams = {
  textbook?: string;
  page?: number;
  limit?: number;
};

export async function listWorkbooksByPassage(
  params: WorkbookListParams,
  db?: Db,
) {
  const d = db ?? (await defaultDb());
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const skip = (page - 1) * limit;

  const passageMatch: Record<string, unknown> = {};
  if (params.textbook?.trim()) {
    passageMatch.textbook = params.textbook.trim();
  }

  const pipeline: Document[] = [
    { $match: passageMatch },
    { $sort: { textbook: 1, 'content.lessonNo': 1, _id: 1 } },
    {
      $facet: {
        total: [{ $count: 'n' }],
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: GENERATED_WORKBOOKS_COLLECTION,
              let: { pid: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$passage_id', '$$pid'] },
                    deleted_at: null,
                  },
                },
                { $sort: { created_at: -1 } },
                {
                  $project: {
                    _id: 1,
                    category: 1,
                    status: 1,
                    truncated_points_count: 1,
                    grammar_points_count: { $size: { $ifNull: ['$grammar_points', []] } },
                    created_at: 1,
                    parent_id: 1,
                  },
                },
              ],
              as: 'workbooks',
            },
          },
          {
            $project: {
              _id: 0,
              passage_id: { $toString: '$_id' },
              textbook: 1,
              source: 1,
              'content.lessonNo': 1,
              'content.page': 1,
              'content.title': 1,
              workbook_count: { $size: '$workbooks' },
              latest_status: { $arrayElemAt: ['$workbooks.status', 0] },
              latest_created_at: { $arrayElemAt: ['$workbooks.created_at', 0] },
              latest_points_count: { $arrayElemAt: ['$workbooks.grammar_points_count', 0] },
              latest_truncated: { $arrayElemAt: ['$workbooks.truncated_points_count', 0] },
              workbooks: '$workbooks',
            },
          },
        ],
      },
    },
  ];

  const [result] = await d.collection('passages').aggregate(pipeline).toArray();
  const total = result?.total?.[0]?.n ?? 0;
  const items = (result?.items ?? []) as Record<string, unknown>[];

  for (const item of items) {
    const wbs = item.workbooks as Record<string, unknown>[] | undefined;
    if (wbs) {
      item.workbooks = wbs.map((w) => ({
        ...w,
        id: String(w._id),
        _id: undefined,
        parent_id: w.parent_id ? String(w.parent_id) : null,
      }));
    }
  }

  return { items, total, page, limit };
}

// ---------------------------------------------------------------------------
// Coverage — 교재별 집계
// ---------------------------------------------------------------------------

export type CoverageRow = {
  textbook: string;
  total_passages: number;
  passages_with_workbook: number;
  coverage_pct: number;
};

export async function listWorkbookCoverage(db?: Db): Promise<CoverageRow[]> {
  const d = db ?? (await defaultDb());

  const passageCounts = await d
    .collection('passages')
    .aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$textbook', count: { $sum: 1 } } },
    ])
    .toArray();

  const workbookPassageCounts = await col(d)
    .aggregate<{ _id: string; count: number }>([
      { $match: { deleted_at: null } },
      { $group: { _id: { textbook: '$textbook', passage_id: '$passage_id' } } },
      { $group: { _id: '$_id.textbook', count: { $sum: 1 } } },
    ])
    .toArray();

  const wbMap = new Map(workbookPassageCounts.map((r) => [r._id, r.count]));

  return passageCounts
    .map((r) => {
      const total = r.count;
      const withWb = wbMap.get(r._id) ?? 0;
      return {
        textbook: r._id,
        total_passages: total,
        passages_with_workbook: withWb,
        coverage_pct: total > 0 ? Math.round((withWb / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.textbook.localeCompare(b.textbook, 'ko'));
}

// ---------------------------------------------------------------------------
// Soft-delete
// ---------------------------------------------------------------------------

export async function softDeleteWorkbook(
  id: string,
  db?: Db,
): Promise<{ ok: boolean; error?: string }> {
  if (!ObjectId.isValid(id)) return { ok: false, error: '유효하지 않은 id' };
  const d = db ?? (await defaultDb());
  const r = await col(d).updateOne(
    { _id: new ObjectId(id), deleted_at: null },
    { $set: { deleted_at: new Date(), updated_at: new Date() } },
  );
  if (r.matchedCount === 0) return { ok: false, error: '문서를 찾을 수 없거나 이미 삭제됨' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Status toggle
// ---------------------------------------------------------------------------

export async function toggleWorkbookStatus(
  id: string,
  db?: Db,
): Promise<{ ok: boolean; newStatus?: string; error?: string }> {
  if (!ObjectId.isValid(id)) return { ok: false, error: '유효하지 않은 id' };
  const d = db ?? (await defaultDb());
  const doc = await col(d).findOne({ _id: new ObjectId(id), deleted_at: null });
  if (!doc) return { ok: false, error: '문서를 찾을 수 없음' };
  const newStatus = doc.status === 'reviewed' ? 'draft' : 'reviewed';
  await col(d).updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: newStatus, updated_at: new Date() } },
  );
  return { ok: true, newStatus };
}
