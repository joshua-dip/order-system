import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { ObjectId, type Document, type Filter } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  buildPassagesExportRows,
  sortPassagesForExport,
  type PassageExportDoc,
} from '@/lib/passages-excel-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PASSAGES_LIMIT = 5000;

type Selection = { textbook?: unknown; chapter?: unknown };
type OrderItem =
  | { kind?: unknown; textbook?: unknown; chapter?: unknown }
  | { kind?: unknown; id?: unknown };
type Doc = PassageExportDoc & { _id: ObjectId };

/**
 * 선택한 (교재, 강) 들 + 개별 지문을 「한줄해석」 엑셀 양식으로 추출.
 * body: { items: [{kind:'chapter',textbook,chapter} | {kind:'passage',id}], fileName? }
 *   - items 순서 그대로 엑셀에 정렬(드래그 재정렬 반영). 강은 그 안에서 번호 순으로 펼침.
 *   - (구버전 호환) items 없으면 selections + passageIds 로 받아 기본 정렬.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    items?: OrderItem[];
    selections?: Selection[];
    passageIds?: unknown;
    fileName?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  /* 순서 보존용 items 우선. 없으면 구버전(selections/passageIds) → items 로 변환. */
  const items: OrderItem[] = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [
        ...(Array.isArray(body.selections) ? body.selections : []).map((s) => ({
          kind: 'chapter',
          textbook: s.textbook,
          chapter: s.chapter,
        })),
        ...(Array.isArray(body.passageIds) ? body.passageIds : []).map((id) => ({ kind: 'passage', id })),
      ];

  const chapterFilter = (tb: string, ch: string): Filter<Document> =>
    ch === ''
      ? { textbook: tb, $or: [{ chapter: '' }, { chapter: null }, { chapter: { $exists: false } }] }
      : { textbook: tb, chapter: ch };

  const ors: Filter<Document>[] = [];
  const passageOids: ObjectId[] = [];
  for (const it of items) {
    if ((it as { kind?: unknown }).kind === 'passage') {
      const id = (it as { id?: unknown }).id;
      if (typeof id === 'string' && ObjectId.isValid(id)) passageOids.push(new ObjectId(id));
    } else {
      const tb = typeof (it as { textbook?: unknown }).textbook === 'string' ? String((it as { textbook?: unknown }).textbook).trim() : '';
      if (!tb) continue;
      const ch = typeof (it as { chapter?: unknown }).chapter === 'string' ? String((it as { chapter?: unknown }).chapter) : '';
      ors.push(chapterFilter(tb, ch));
    }
  }
  if (passageOids.length > 0) ors.push({ _id: { $in: passageOids } });

  if (ors.length === 0) {
    return NextResponse.json({ error: '추출할 교재·강 또는 지문을 선택하세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const filter: Filter<Document> = ors.length === 1 ? ors[0] : { $or: ors };
  const docs = (await db
    .collection('passages')
    .find(filter)
    .project({ textbook: 1, chapter: 1, page: 1, order: 1, number: 1, content: 1 })
    .limit(PASSAGES_LIMIT)
    .toArray()) as Doc[];

  if (docs.length === 0) {
    return NextResponse.json({ error: '선택한 범위에 지문이 없습니다.' }, { status: 404 });
  }

  /* items 순서대로 펼치기 — 강은 번호 순, 지문은 단건. 중복은 첫 등장만. */
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const used = new Set<string>();
  const ordered: Doc[] = [];
  for (const it of items) {
    if ((it as { kind?: unknown }).kind === 'passage') {
      const id = String((it as { id?: unknown }).id ?? '');
      const d = byId.get(id);
      if (d && !used.has(id)) { used.add(id); ordered.push(d); }
    } else {
      const tb = typeof (it as { textbook?: unknown }).textbook === 'string' ? String((it as { textbook?: unknown }).textbook).trim() : '';
      if (!tb) continue;
      const ch = typeof (it as { chapter?: unknown }).chapter === 'string' ? String((it as { chapter?: unknown }).chapter) : '';
      const group = sortPassagesForExport(
        docs.filter((d) => (d.textbook ?? '') === tb && (ch === '' ? !d.chapter : (d.chapter ?? '') === ch)),
      );
      for (const d of group) {
        const id = String(d._id);
        if (!used.has(id)) { used.add(id); ordered.push(d); }
      }
    }
  }
  const passages: PassageExportDoc[] = ordered.length > 0 ? ordered : docs;

  const aoa = buildPassagesExportRows(passages, { preserveOrder: true });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 22 }, { wch: 22 }, { wch: 7 }, { wch: 6 }, { wch: 9 },
    { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();

  /* 사용자 지정 저장명 우선 — 비우면 교재명(단일) 또는 '지문추출' 자동 */
  const rawName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const cleanName = rawName
    .replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const uniqueTextbooks = Array.from(new Set(passages.map((p) => String(p.textbook ?? '')).filter(Boolean)));
  const baseName = cleanName || (uniqueTextbooks.length === 1 ? uniqueTextbooks[0] : '지문추출');
  const sheetName = baseName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || '지문';
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const fileName = `${baseName}.xlsx`;
  const encoded = encodeURIComponent(fileName);
  const asciiFallback = `passages-export-${Date.now()}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(buf.byteLength),
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store',
    },
  });
}
