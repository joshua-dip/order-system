import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const ASSIGN_COL = 'passage_analyzer_file_folders';
const LINK_LINK_ASSIGN = 'textbook_link_folder_assignments';

const LINK_FOLDER_ID_RE = /^[a-f0-9]{24}$/i;

function normalizeLinkFolderId(raw: unknown): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  return s.trim().toLowerCase();
}

function serialize(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    _id: String(_id),
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const chapter = searchParams.get('chapter')?.trim() || '';
  const q = searchParams.get('q')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  /** 변형문제 생성 시 교재 전체 지문 선택 등 — 상한 확대 */
  const limit = Math.min(2000, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;
  /** 지문별 분류(passage_analyzer_file_folders): 빈 값=전체, unassigned, 그 외=폴더 _id */
  const folderScope = searchParams.get('folderScope')?.trim() || '';
  /** 교재 구매 링크와 동일(textbook_link_*): 교재명(textbook 필드) 기준 */
  const linkFolderScope = searchParams.get('linkFolderScope')?.trim() || '';

  const filter: Record<string, unknown> = {};
  const textbookParam = textbook;
  if (chapter) filter.chapter = { $regex: chapter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (q) {
    filter.$or = [
      { number: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { source_key: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { 'content.original': { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const assignCol = db.collection(ASSIGN_COL);
    const userId = payload?.loginId || '';

    if (linkFolderScope) {
      const linkAssigns = await db
        .collection(LINK_LINK_ASSIGN)
        .find({})
        .project({ textbookKey: 1, folderId: 1 })
        .toArray();
      const keysForFolder = new Map<string, string[]>();
      const keysWithLinkFolder = new Set<string>();
      for (const a of linkAssigns) {
        const k = String((a as { textbookKey?: string }).textbookKey ?? '').trim();
        const fid = normalizeLinkFolderId((a as { folderId?: unknown }).folderId);
        if (!k || !fid) continue;
        keysWithLinkFolder.add(k);
        if (!keysForFolder.has(fid)) keysForFolder.set(fid, []);
        keysForFolder.get(fid)!.push(k);
      }

      if (linkFolderScope === 'unassigned') {
        if (textbookParam) {
          if (keysWithLinkFolder.has(textbookParam)) {
            filter.textbook = { $in: [] as string[] };
          } else {
            filter.textbook = textbookParam;
          }
        } else if (keysWithLinkFolder.size > 0) {
          filter.textbook = { $nin: Array.from(keysWithLinkFolder) };
        }
      } else if (LINK_FOLDER_ID_RE.test(linkFolderScope)) {
        const lid = linkFolderScope.toLowerCase();
        const keys = keysForFolder.get(lid) ?? [];
        if (textbookParam) {
          if (keys.includes(textbookParam)) {
            filter.textbook = textbookParam;
          } else {
            filter.textbook = { $in: [] as string[] };
          }
        } else {
          filter.textbook = keys.length > 0 ? { $in: keys } : { $in: [] as string[] };
        }
      } else {
        filter.textbook = { $in: [] as string[] };
      }
    } else if (textbookParam) {
      filter.textbook = textbookParam;
    }

    if (folderScope && userId) {
      const assigns = await assignCol.find({ userId }).toArray();
      const passageFolder = new Map<string, string>();
      for (const a of assigns) {
        const fn = String((a as { fileName?: string }).fileName || '');
        const m = fn.match(/^passage:([a-f0-9]{24})$/i);
        if (!m) continue;
        const fid = String((a as { folderId?: string | null }).folderId ?? '').trim();
        passageFolder.set(m[1].toLowerCase(), fid);
      }

      if (folderScope === 'unassigned') {
        const inAnyFolder: ObjectId[] = [];
        for (const [pid, fid] of passageFolder) {
          if (fid) {
            try {
              inAnyFolder.push(new ObjectId(pid));
            } catch {
              /* skip */
            }
          }
        }
        if (inAnyFolder.length > 0) {
          filter._id = { $nin: inAnyFolder };
        }
      } else if (ObjectId.isValid(folderScope)) {
        const inFolder: ObjectId[] = [];
        for (const [pid, fid] of passageFolder) {
          if (fid === folderScope) {
            try {
              inFolder.push(new ObjectId(pid));
            } catch {
              /* skip */
            }
          }
        }
        filter._id = { $in: inFolder };
      }
    }

    const [total, items] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ textbook: 1, chapter: 1, order: 1, number: 1 })
        .skip(skip)
        .limit(limit)
        .project({
          textbook: 1,
          chapter: 1,
          number: 1,
          source_key: 1,
          passage_source: 1,
          page: 1,
          page_label: 1,
          order: 1,
          publisher: 1,
          'content.original': 1,
          created_at: 1,
          updated_at: 1,
        })
        .toArray(),
    ]);

    let serialized = items.map((d) => serialize(d as Record<string, unknown>)) as Record<string, unknown>[];

    if (userId && serialized.length > 0) {
      const keys = serialized.map((row) => passageAnalysisFileNameForPassageId(String(row._id)));
      const relevant = await assignCol
        .find({ userId, fileName: { $in: keys } })
        .project({ fileName: 1, folderId: 1 })
        .toArray();
      const folderByFile = new Map<string, string | null>();
      for (const a of relevant) {
        const fn = String((a as { fileName?: string }).fileName || '');
        const raw = (a as { folderId?: string | null }).folderId;
        folderByFile.set(fn, raw != null && String(raw).trim() ? String(raw).trim() : null);
      }
      serialized = serialized.map((row) => {
        const fn = passageAnalysisFileNameForPassageId(String(row._id));
        const fid = folderByFile.has(fn) ? folderByFile.get(fn) : null;
        return { ...row, folder_id: fid ?? null };
      });
    } else {
      serialized = serialized.map((row) => ({ ...row, folder_id: null }));
    }

    return NextResponse.json({
      items: serialized,
      total,
      page,
      limit,
    });
  } catch (e) {
    console.error('passages GET:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

function buildContent(body: Record<string, unknown>) {
  const existing = (body.content as Record<string, unknown> | undefined) || {};
  const original = typeof body.original === 'string' ? body.original : String(existing.original ?? '');
  const translation =
    typeof body.translation === 'string' ? body.translation : String(existing.translation ?? '');
  return {
    original,
    translation,
    sentences_en: Array.isArray(existing.sentences_en) ? existing.sentences_en : [],
    sentences_ko: Array.isArray(existing.sentences_ko) ? existing.sentences_ko : [],
    tokenized_en: typeof existing.tokenized_en === 'string' ? existing.tokenized_en : '',
    tokenized_ko: typeof existing.tokenized_ko === 'string' ? existing.tokenized_ko : '',
    mixed: typeof existing.mixed === 'string' ? existing.mixed : '',
  };
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : '';
    const number = typeof body.number === 'string' ? body.number.trim() : '';
    if (!textbook || !chapter || !number) {
      return NextResponse.json({ error: '교재명, 강(회차), 번호는 필수입니다.' }, { status: 400 });
    }

    const source_key =
      typeof body.source_key === 'string' && body.source_key.trim()
        ? body.source_key.trim()
        : `${chapter} ${number}`;
    const pageNum =
      typeof body.page === 'number' && !Number.isNaN(body.page)
        ? body.page
        : typeof body.page === 'string'
          ? parseInt(body.page, 10)
          : undefined;
    const page_label = typeof body.page_label === 'string' ? body.page_label.trim() : '';
    const order =
      typeof body.order === 'number' && !Number.isNaN(body.order)
        ? body.order
        : typeof body.order === 'string'
          ? parseInt(body.order, 10) || 0
          : 0;

    const VALID_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;
    type Publisher = typeof VALID_PUBLISHERS[number];
    const publisherRaw = typeof body.publisher === 'string' ? body.publisher.trim() : '';
    const publisher: Publisher | undefined = VALID_PUBLISHERS.includes(publisherRaw as Publisher)
      ? (publisherRaw as Publisher)
      : undefined;

    const now = new Date();
    const doc: Record<string, unknown> = {
      textbook,
      chapter,
      number,
      source_key,
      page: pageNum,
      page_label: page_label || undefined,
      order,
      content: buildContent(body),
      created_at: now,
      updated_at: now,
    };
    if (publisher) doc.publisher = publisher;

    const db = await getDb('gomijoshua');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await db.collection('passages').insertOne(doc as any);
    const inserted = await db.collection('passages').findOne({ _id: r.insertedId });
    return NextResponse.json({ ok: true, item: inserted ? serialize(inserted as Record<string, unknown>) : null });
  } catch (e) {
    console.error('passages POST:', e);
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 });
  }
}
