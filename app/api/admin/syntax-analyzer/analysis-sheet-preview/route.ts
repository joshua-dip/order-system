import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { buildAnalysisSheetHtml, type SheetOptions } from '@/lib/analysis-sheet-html';
import { buildSheetPassages, type SheetPassageSource } from '@/lib/analysis-sheet-load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 분석지 미리보기 — PDF 와 같은 조판기로 HTML 만 돌려준다(리체움 sheet-preview 와 동일 발상).
 * 옵션을 만질 때마다 부르므로 puppeteer 없이 가볍게. body: { passageIds, options?, limit? }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { passageIds?: unknown; options?: unknown; limit?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, message: '요청 형식 오류' }, { status: 400 });
  }
  const ids = (Array.isArray(body.passageIds) ? body.passageIds : [])
    .map((x) => String(x ?? '').trim())
    .filter((id) => ObjectId.isValid(id));
  if (ids.length === 0) {
    return NextResponse.json({ success: false, message: '지문을 선택해 주세요.' }, { status: 400 });
  }
  /* 미리보기는 앞 몇 편만 — 25편을 매번 그리면 편집이 굼떠진다(리체움과 같은 이유). */
  const limit = Math.max(1, Math.min(Number(body.limit) || 2, 25));

  const db = await getDb('gomijoshua');
  const scope = ids.slice(0, limit);
  const passageDocs = await db.collection('passages')
    .find({ _id: { $in: scope.map((id) => new ObjectId(id)) } })
    .project({ source_key: 1, textbook: 1, page_label: 1, page: 1 })
    .toArray();
  const byId = new Map(passageDocs.map((d) => [String(d._id), d]));
  const analyses = await db.collection('passage_analyses')
    .find({ fileName: { $in: scope.map((id) => passageAnalysisFileNameForPassageId(id)) } })
    .project({ fileName: 1, 'passageStates.main': 1 })
    .toArray();
  const mainByPid = new Map(
    analyses.map((d) => {
      const m = /^passage:([a-f0-9]{24})$/i.exec(String((d as { fileName?: string }).fileName ?? ''));
      return [m ? m[1].toLowerCase() : '', (d as Record<string, any>).passageStates?.main] as const;
    }),
  );

  const sources: SheetPassageSource[] = [];
  let textbook = '';
  for (const id of scope) {
    const p = byId.get(id);
    const main = mainByPid.get(id.toLowerCase());
    if (!p || !main?.sentences?.length) continue;
    textbook = String(p.textbook ?? textbook);
    sources.push({
      textbook,
      sourceKey: String(p.source_key ?? ''),
      pageLabel: String(p.page_label ?? p.page ?? ''),
      main,
    });
  }
  const passages = buildSheetPassages(sources);
  if (!passages.length) {
    return NextResponse.json({ success: false, message: '선택한 지문에 저장된 분석이 없습니다.' }, { status: 400 });
  }

  const html = buildAnalysisSheetHtml({
    title: textbook,
    subtitle: '지문 분석지',
    passages,
    brand: '',
    options: (body.options ?? {}) as Partial<SheetOptions>,
  });
  return NextResponse.json({ success: true, html, total: ids.length, shown: passages.length });
}
