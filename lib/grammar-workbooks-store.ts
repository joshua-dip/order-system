/**
 * grammar_workbooks 컬렉션 스토어 — 한 지문(passage) 의 4모드(F·G·H·J) 워크북을 통합 저장.
 *
 * 한 doc 당 1 지문 (passageId·sourceKey 매칭). 모드별 selection 데이터·HTML 을 함께 보관.
 * upsert by (passageId, folder) — 같은 passage 를 다시 저장하면 overwrite.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { SelectionBlock, SentenceTokenized } from './block-workbook-types';
import type {
  EitherOrPoint,
  CorrectionSpan,
  OxItem,
  ExamMeta,
  GrammarPoint,
} from './grammar-workbook-html';

export type GrammarMode = 'F' | 'G' | 'H' | 'J';
export const GRAMMAR_MODES: GrammarMode[] = ['F', 'G', 'H', 'J'];

export interface GrammarModeData {
  /** F 어형 변환 — SelectionBlock[] (word 블록 + baseForm) */
  F?: { blocks: SelectionBlock[] };
  /** G 양자택일 */
  G?: { points: EitherOrPoint[] };
  /** H 어법 오류 수정 */
  H?: { spans: CorrectionSpan[] };
  /** J O·X 채점 */
  J?: { items: OxItem[]; intro?: string };
  /** ✨ P 어법 포인트 풀 — G·H·J 의 source 가 되는 1차 데이터. 호환성을 위해 optional. */
  P?: { points: GrammarPoint[] };
}

export interface GrammarWorkbookSaveInput {
  passageId?: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder?: string;
  /** 시험지 메타 (헤더·문항바에 노출) */
  examMeta?: ExamMeta;
  /** 본문 토큰화 결과 (F/G/H 모드에서 사용). J 단독이면 비어도 됨. */
  sentences: SentenceTokenized[];
  /** 활성화된 모드 (저장 시점 기준) */
  modes: GrammarMode[];
  /** 모드별 데이터 */
  modeData: GrammarModeData;
  /** 모드별 미리 생성된 HTML — 없으면 서버에서 빌드 */
  html?: Partial<Record<GrammarMode, string>>;
}

export interface GrammarWorkbookDb {
  _id?: ObjectId;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder: string;
  examMeta?: ExamMeta;
  sentences: SentenceTokenized[];
  modes: GrammarMode[];
  modeData: GrammarModeData;
  html: Partial<Record<GrammarMode, string>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GrammarWorkbookListItem {
  _id: string;
  passageId?: string;
  title: string;
  textbook: string;
  sourceKey: string;
  folder: string;
  modes: GrammarMode[];
  createdAt: string;
  updatedAt: string;
}

export interface GrammarWorkbookFull {
  _id: string;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder: string;
  examMeta?: ExamMeta;
  sentences: SentenceTokenized[];
  modes: GrammarMode[];
  modeData: GrammarModeData;
  html: Partial<Record<GrammarMode, string>>;
  createdAt: string;
  updatedAt: string;
}

const COL = 'grammar_workbooks';

function toListItem(d: GrammarWorkbookDb & { _id: ObjectId }): GrammarWorkbookListItem {
  return {
    _id: String(d._id),
    passageId: d.passageId,
    title: String(d.title ?? ''),
    textbook: String(d.textbook ?? ''),
    sourceKey: String(d.sourceKey ?? ''),
    folder: String(d.folder ?? '기본'),
    modes: Array.isArray(d.modes) ? d.modes : [],
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : '',
  };
}

function toFull(d: GrammarWorkbookDb & { _id: ObjectId }): GrammarWorkbookFull {
  return {
    _id: String(d._id),
    passageId: d.passageId,
    textbook: d.textbook,
    sourceKey: d.sourceKey,
    title: d.title,
    folder: d.folder ?? '기본',
    examMeta: d.examMeta,
    sentences: d.sentences ?? [],
    modes: d.modes ?? [],
    modeData: d.modeData ?? {},
    html: d.html ?? {},
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : '',
  };
}

/** 저장된 워크북 페이지네이션 목록 (최근 수정 순). */
export async function listGrammarWorkbooks(opts?: {
  textbook?: string;
  folder?: string;
  limit?: number;
}): Promise<GrammarWorkbookListItem[]> {
  const db = await getDb('gomijoshua');
  const filter: Record<string, unknown> = {};
  if (opts?.textbook?.trim()) filter.textbook = opts.textbook.trim();
  if (opts?.folder?.trim() && opts.folder !== 'all') filter.folder = opts.folder.trim();
  const lim = Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 200)));

  const docs = await db
    .collection(COL)
    .find(filter)
    .project({ passageId: 1, title: 1, textbook: 1, sourceKey: 1, folder: 1, modes: 1, createdAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(lim)
    .toArray();

  return docs.map(d => toListItem(d as GrammarWorkbookDb & { _id: ObjectId }));
}

/** 전 컬렉션에 존재하는 folder 목록과 doc 개수. 기본 폴더는 「기본」 으로 보장. */
export async function listGrammarFolders(): Promise<{
  folders: string[];
  folderCounts: Record<string, number>;
  total: number;
}> {
  const db = await getDb('gomijoshua');
  const rows = await db
    .collection(COL)
    .aggregate<{ _id: string; count: number }>([
      {
        $group: {
          _id: { $ifNull: ['$folder', '기본'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  const folderCounts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const k = (r._id || '기본').toString();
    folderCounts[k] = r.count;
    total += r.count;
  }
  if (!folderCounts['기본']) folderCounts['기본'] = 0;
  // 「기본」을 항상 맨 앞으로
  const others = Object.keys(folderCounts)
    .filter(k => k !== '기본')
    .sort();
  return { folders: ['기본', ...others], folderCounts, total };
}

/** 폴더 일괄 변경 (지정 폴더의 모든 doc → 새 이름). 이름 중복 불가. */
export async function renameGrammarFolder(from: string, to: string): Promise<number> {
  const src = (from ?? '').trim() || '기본';
  const dst = (to ?? '').trim() || '기본';
  if (src === dst) return 0;
  const db = await getDb('gomijoshua');
  // 충돌 방지: 동일 (passageId, dst) 가 이미 있으면 그 doc 은 옮기지 않고 src 그대로 둠
  const conflicts = await db
    .collection(COL)
    .aggregate<{ _id: string }>([
      { $match: { folder: src, passageId: { $type: 'string', $ne: '' } } },
      {
        $lookup: {
          from: COL,
          let: { pid: '$passageId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$folder', dst] }, { $eq: ['$passageId', '$$pid'] }] } } },
            { $project: { _id: 1 } },
          ],
          as: 'dup',
        },
      },
      { $match: { 'dup.0': { $exists: true } } },
      { $project: { _id: 1 } },
    ])
    .toArray();
  const conflictIds = new Set(conflicts.map(c => String(c._id)));
  const filter: Record<string, unknown> =
    conflictIds.size > 0
      ? { folder: src, _id: { $nin: [...conflictIds].map(id => new ObjectId(id)) } }
      : { folder: src };
  const r = await db
    .collection(COL)
    .updateMany(filter, { $set: { folder: dst, updatedAt: new Date() } });
  return r.modifiedCount;
}

/** 폴더 통째로 삭제 (그 폴더의 모든 doc). */
export async function deleteGrammarFolder(folder: string): Promise<number> {
  const name = (folder ?? '').trim();
  if (!name || name === 'all') return 0;
  const db = await getDb('gomijoshua');
  const r = await db.collection(COL).deleteMany({ folder: name });
  return r.deletedCount;
}

export async function getGrammarWorkbook(id: string): Promise<GrammarWorkbookFull | null> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return null;
  }
  const doc = await db.collection(COL).findOne({ _id: oid });
  if (!doc) return null;
  return toFull(doc as unknown as GrammarWorkbookDb & { _id: ObjectId });
}

/** passageId 로 찾기 (있으면 1개, 같은 폴더가 여러 개면 가장 최근). */
export async function getGrammarWorkbookByPassage(
  passageId: string,
  folder?: string,
): Promise<GrammarWorkbookFull | null> {
  const db = await getDb('gomijoshua');
  const filter: Record<string, unknown> = { passageId };
  if (folder?.trim() && folder !== 'all') filter.folder = folder.trim();
  const doc = await db.collection(COL).find(filter).sort({ updatedAt: -1 }).limit(1).next();
  if (!doc) return null;
  return toFull(doc as unknown as GrammarWorkbookDb & { _id: ObjectId });
}

/**
 * 저장 — (passageId, folder) 가 동일하면 upsert.
 * passageId 가 없으면 항상 신규 insert.
 */
export async function saveGrammarWorkbook(
  payload: GrammarWorkbookSaveInput,
): Promise<{ id: string; created: boolean }> {
  const db = await getDb('gomijoshua');
  const now = new Date();
  const folder = (payload.folder ?? '').trim() || '기본';
  const doc = {
    passageId: payload.passageId?.trim() || undefined,
    textbook: payload.textbook,
    sourceKey: payload.sourceKey,
    title: payload.title,
    folder,
    examMeta: payload.examMeta,
    sentences: payload.sentences ?? [],
    modes: payload.modes,
    modeData: payload.modeData,
    html: payload.html ?? {},
    updatedAt: now,
  } satisfies Omit<GrammarWorkbookDb, '_id' | 'createdAt'>;

  if (doc.passageId) {
    const existing = await db.collection(COL).findOne({ passageId: doc.passageId, folder });
    if (existing) {
      await db.collection(COL).updateOne({ _id: existing._id }, { $set: doc });
      return { id: String(existing._id), created: false };
    }
  }
  const r = await db.collection(COL).insertOne({ ...doc, createdAt: now });
  return { id: String(r.insertedId), created: true };
}

export async function deleteGrammarWorkbook(id: string): Promise<boolean> {
  const db = await getDb('gomijoshua');
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return false;
  }
  const r = await db.collection(COL).deleteOne({ _id: oid });
  return r.deletedCount > 0;
}

/**
 * 교재별 진척률 — 각 교재의 (지문 수, 저장된 워크북 지문 수, 모드별 분포) 반환.
 * 서술형 출제기 「현황」 패널과 동일한 패턴.
 */
export interface TextbookCoverage {
  textbook: string;
  passagesTotal: number;
  workbookPassagesCovered: number;
  coverageRate: number; // 0..1
  /** 모드별 완료 지문 수 (각 모드가 modes 배열에 들어 있는 doc 카운트) */
  modeCounts: Record<GrammarMode, number>;
}

export async function getTextbookCoverage(opts?: { limit?: number }): Promise<TextbookCoverage[]> {
  const db = await getDb('gomijoshua');
  const lim = Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 200)));

  // 1) 전체 교재 + 지문 수
  const passageRows = await db
    .collection('passages')
    .aggregate([
      { $match: { textbook: { $ne: null } } },
      { $group: { _id: '$textbook', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: lim },
    ])
    .toArray();

  // 2) workbook 별 교재·passageId·modes
  const wbRows = await db
    .collection(COL)
    .aggregate([
      { $group: { _id: { textbook: '$textbook', passageId: '$passageId' }, modes: { $push: '$modes' } } },
    ])
    .toArray();

  type Acc = { covered: Set<string>; modeCounts: Record<GrammarMode, number> };
  const byTextbook = new Map<string, Acc>();
  for (const row of wbRows) {
    const tb = String((row._id as { textbook?: string }).textbook ?? '');
    const pid = String((row._id as { passageId?: string }).passageId ?? '');
    if (!tb) continue;
    let acc = byTextbook.get(tb);
    if (!acc) {
      acc = { covered: new Set(), modeCounts: { F: 0, G: 0, H: 0, J: 0 } };
      byTextbook.set(tb, acc);
    }
    if (pid) acc.covered.add(pid);
    const seen = new Set<GrammarMode>();
    for (const arr of row.modes as GrammarMode[][]) {
      if (Array.isArray(arr)) for (const m of arr) seen.add(m);
    }
    for (const m of seen) acc.modeCounts[m] = (acc.modeCounts[m] ?? 0) + 1;
  }

  return passageRows.map(row => {
    const tb = String(row._id ?? '');
    const total = Number(row.count ?? 0);
    const acc = byTextbook.get(tb) ?? { covered: new Set<string>(), modeCounts: { F: 0, G: 0, H: 0, J: 0 } };
    const covered = acc.covered.size;
    return {
      textbook: tb,
      passagesTotal: total,
      workbookPassagesCovered: covered,
      coverageRate: total > 0 ? covered / total : 0,
      modeCounts: acc.modeCounts,
    } satisfies TextbookCoverage;
  });
}

/**
 * 한 교재에서 sourceKey 별 workbook 카운트.
 * UI 의 passage picker / 현황 patch 용 (essay-generator passage-exam-counts 와 동일 모양).
 */
export async function getPassageCountsByTextbook(
  textbook: string,
): Promise<Record<string, { total: number; modes: Record<GrammarMode, number> }>> {
  if (!textbook?.trim()) return {};
  const db = await getDb('gomijoshua');
  const rows = await db
    .collection(COL)
    .aggregate([
      { $match: { textbook: textbook.trim() } },
      { $project: { sourceKey: 1, modes: 1 } },
    ])
    .toArray();

  const map: Record<string, { total: number; modes: Record<GrammarMode, number> }> = {};
  for (const r of rows) {
    const sk = String((r as { sourceKey?: string }).sourceKey ?? '');
    if (!sk) continue;
    if (!map[sk]) map[sk] = { total: 0, modes: { F: 0, G: 0, H: 0, J: 0 } };
    map[sk].total += 1;
    const modes = (r as { modes?: GrammarMode[] }).modes ?? [];
    for (const m of modes) {
      if (m in map[sk].modes) map[sk].modes[m] += 1;
    }
  }
  return map;
}

/**
 * 한 교재의 지문 그리드 — 강/번호/source_key + 각 지문에 저장된 grammar_workbooks 의 모드 집합.
 * 현황 모달의 drill-down 표 데이터.
 */
export interface PassageGridRow {
  passage_id: string;
  chapter: string;
  number: string;
  source_key: string;
  has_F: boolean;
  has_G: boolean;
  has_H: boolean;
  has_J: boolean;
  doc_id?: string;
  folder?: string;
  updated_at?: string;
}

export async function getPassageGrid(textbook: string): Promise<PassageGridRow[]> {
  if (!textbook?.trim()) return [];
  const db = await getDb('gomijoshua');
  const tb = textbook.trim();

  const passages = await db
    .collection('passages')
    .find({ textbook: tb })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();

  // 같은 passageId 의 가장 최근 doc 만 사용 (folder 가 여러 개면 가장 최근).
  // sourceKey 매칭은 passageId 없는 옛 doc 호환.
  const wbDocs = await db
    .collection(COL)
    .find({ textbook: tb })
    .project({ _id: 1, passageId: 1, sourceKey: 1, modes: 1, folder: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .toArray();

  const byPid = new Map<string, { _id: string; modes: GrammarMode[]; folder: string; updatedAt?: Date }>();
  const bySk = new Map<string, { _id: string; modes: GrammarMode[]; folder: string; updatedAt?: Date }>();
  for (const w of wbDocs) {
    const pid = (w as { passageId?: string }).passageId;
    const sk = (w as { sourceKey?: string }).sourceKey;
    const wid = String((w as { _id: ObjectId })._id);
    const modes = ((w as { modes?: GrammarMode[] }).modes ?? []).filter(m => (GRAMMAR_MODES as string[]).includes(m));
    const folder = String((w as { folder?: string }).folder ?? '기본');
    const updatedAt = (w as { updatedAt?: Date }).updatedAt;
    if (pid && !byPid.has(String(pid))) {
      byPid.set(String(pid), { _id: wid, modes, folder, updatedAt });
    } else if (!pid && sk && !bySk.has(String(sk))) {
      bySk.set(String(sk), { _id: wid, modes, folder, updatedAt });
    }
  }

  return passages.map(p => {
    const pid = String(p._id);
    const sk = String(p.source_key ?? '');
    const hit = byPid.get(pid) ?? bySk.get(sk);
    const modes = new Set<GrammarMode>(hit?.modes ?? []);
    return {
      passage_id: pid,
      chapter: String(p.chapter ?? ''),
      number: String(p.number ?? ''),
      source_key: sk,
      has_F: modes.has('F'),
      has_G: modes.has('G'),
      has_H: modes.has('H'),
      has_J: modes.has('J'),
      doc_id: hit?._id,
      folder: hit?.folder,
      updated_at: hit?.updatedAt ? new Date(hit.updatedAt).toISOString() : undefined,
    } satisfies PassageGridRow;
  });
}

/**
 * 부족 지문 — 한 교재의 지문 중 (모드 집합 requiredModes 가 모두 채워진 doc) 가 없는 지문.
 * cc:grammar shortage 출력.
 */
export interface GrammarShortageRow {
  passage_id: string;
  source_key: string;
  chapter: string;
  number: string;
  have_modes: GrammarMode[];
  need_modes: GrammarMode[];
}

export async function getGrammarShortage(opts: {
  textbook: string;
  requiredModes: GrammarMode[];
  folder?: string;
  /** 특정 「강」만 — 정확히 일치하는 chapter 만 필터 (다중: 쉼표/배열). 'all' 이면 무필터. */
  chapter?: string | string[];
}): Promise<{
  textbook: string;
  required: GrammarMode[];
  folder: string;
  chapter: string | string[] | 'all';
  passagesTotal: number;
  shortageCount: number;
  shortage: GrammarShortageRow[];
  /** 교재의 모든 「강」 목록 (passages.chapter) — UI 에서 강별 navigation 용 */
  chapters: { chapter: string; passagesTotal: number }[];
}> {
  const db = await getDb('gomijoshua');
  const folder = (opts.folder ?? 'all').trim();
  // chapter 입력 정규화
  const chapterFilter = (() => {
    if (!opts.chapter) return null;
    if (Array.isArray(opts.chapter)) {
      const arr = opts.chapter.map(s => String(s).trim()).filter(Boolean);
      return arr.length > 0 ? arr : null;
    }
    const s = String(opts.chapter).trim();
    if (!s || s === 'all') return null;
    return s.includes(',') ? s.split(',').map(p => p.trim()).filter(Boolean) : [s];
  })();
  const passageFilter: Record<string, unknown> = { textbook: opts.textbook };
  if (chapterFilter) passageFilter.chapter = { $in: chapterFilter };
  const passages = await db
    .collection('passages')
    .find(passageFilter)
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();
  // 교재 전체의 「강」목록 (필터 무관) — 클라이언트에서 강별 chip/button 만들 때 사용
  const chapterRowsAll = await db
    .collection('passages')
    .aggregate<{ _id: string; count: number }>([
      { $match: { textbook: opts.textbook, chapter: { $ne: null } } },
      { $group: { _id: { $ifNull: ['$chapter', ''] }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  const chapters = chapterRowsAll.map(r => ({
    chapter: String(r._id ?? ''),
    passagesTotal: r.count,
  }));

  const wbFilter: Record<string, unknown> = { textbook: opts.textbook };
  if (folder && folder !== 'all') wbFilter.folder = folder;
  const workbooks = await db
    .collection(COL)
    .find(wbFilter)
    .project({ passageId: 1, sourceKey: 1, modes: 1 })
    .toArray();

  const modesByPid = new Map<string, Set<GrammarMode>>();
  const modesBySk = new Map<string, Set<GrammarMode>>();
  for (const w of workbooks) {
    const pid = (w as { passageId?: string }).passageId;
    const sk = (w as { sourceKey?: string }).sourceKey;
    const modes = (w as { modes?: GrammarMode[] }).modes ?? [];
    if (pid) {
      let set = modesByPid.get(String(pid));
      if (!set) {
        set = new Set();
        modesByPid.set(String(pid), set);
      }
      for (const m of modes) set.add(m);
    } else if (sk) {
      let set = modesBySk.get(String(sk));
      if (!set) {
        set = new Set();
        modesBySk.set(String(sk), set);
      }
      for (const m of modes) set.add(m);
    }
  }

  const shortage: GrammarShortageRow[] = [];
  for (const p of passages) {
    const pid = String(p._id);
    const sk = String(p.source_key ?? '');
    const have = new Set<GrammarMode>([
      ...(modesByPid.get(pid) ?? []),
      ...(modesBySk.get(sk) ?? []),
    ]);
    const need = opts.requiredModes.filter(m => !have.has(m));
    if (need.length > 0) {
      shortage.push({
        passage_id: pid,
        source_key: sk,
        chapter: String(p.chapter ?? ''),
        number: String(p.number ?? ''),
        have_modes: [...have].sort(),
        need_modes: need,
      });
    }
  }

  return {
    textbook: opts.textbook,
    required: opts.requiredModes,
    folder,
    chapter: chapterFilter ?? 'all',
    passagesTotal: passages.length,
    shortageCount: shortage.length,
    shortage,
    chapters,
  };
}
