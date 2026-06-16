import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { ObjectId, type Document, type Filter } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { buildPassagesExportRows, type PassageExportDoc } from '@/lib/passages-excel-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PASSAGES_LIMIT = 5000;

type Selection = { textbook?: unknown; chapter?: unknown };

/**
 * 선택한 (교재, 강) 들 + 개별 지문(passageIds)을 「한줄해석」 엑셀 양식으로 추출.
 * body: { selections: [{ textbook, chapter }], passageIds?: string[] }  (chapter '' = 강 없음/전체)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { selections?: Selection[]; passageIds?: unknown };
  try {
    body = (await request.json()) as { selections?: Selection[]; passageIds?: unknown };
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const selections = Array.isArray(body.selections) ? body.selections : [];
  const ors: Filter<Document>[] = [];
  for (const s of selections) {
    const tb = typeof s.textbook === 'string' ? s.textbook.trim() : '';
    if (!tb) continue;
    const ch = typeof s.chapter === 'string' ? s.chapter : '';
    if (ch === '') {
      ors.push({ textbook: tb, $or: [{ chapter: '' }, { chapter: null }, { chapter: { $exists: false } }] });
    } else {
      ors.push({ textbook: tb, chapter: ch });
    }
  }

  const passageOids = (Array.isArray(body.passageIds) ? body.passageIds : [])
    .filter((x): x is string => typeof x === 'string' && ObjectId.isValid(x))
    .map((x) => new ObjectId(x));
  if (passageOids.length > 0) {
    ors.push({ _id: { $in: passageOids } });
  }

  if (ors.length === 0) {
    return NextResponse.json({ error: '추출할 교재·강 또는 지문을 선택하세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const filter: Filter<Document> = ors.length === 1 ? ors[0] : { $or: ors };
  const passages = (await db
    .collection('passages')
    .find(filter)
    .project({ textbook: 1, chapter: 1, page: 1, order: 1, number: 1, content: 1 })
    .limit(PASSAGES_LIMIT)
    .toArray()) as PassageExportDoc[];

  if (passages.length === 0) {
    return NextResponse.json({ error: '선택한 범위에 지문이 없습니다.' }, { status: 404 });
  }

  const aoa = buildPassagesExportRows(passages);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 22 }, { wch: 22 }, { wch: 7 }, { wch: 6 }, { wch: 9 },
    { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();

  const uniqueTextbooks = Array.from(new Set(passages.map((p) => String(p.textbook ?? '')).filter(Boolean)));
  const baseName = uniqueTextbooks.length === 1 ? uniqueTextbooks[0] : '지문추출';
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
