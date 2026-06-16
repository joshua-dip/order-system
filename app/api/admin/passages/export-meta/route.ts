import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 엑셀 추출 모달용 메타 — 교재별 강(chapter) 목록과 지문 수.
 * 반환: { textbooks: [{ textbook, total, chapters: [{ chapter, count }] }] }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const agg = await db
    .collection('passages')
    .aggregate([
      { $group: { _id: { textbook: '$textbook', chapter: '$chapter' }, count: { $sum: 1 } } },
    ])
    .toArray();

  const map = new Map<string, { chapter: string; count: number }[]>();
  for (const g of agg as Array<{ _id?: { textbook?: unknown; chapter?: unknown }; count?: number }>) {
    const tb = String(g._id?.textbook ?? '').trim();
    if (!tb) continue;
    const ch = g._id?.chapter == null ? '' : String(g._id.chapter);
    if (!map.has(tb)) map.set(tb, []);
    map.get(tb)!.push({ chapter: ch, count: Number(g.count ?? 0) });
  }

  const textbooks = [...map.entries()]
    .map(([textbook, chapters]) => ({
      textbook,
      total: chapters.reduce((s, c) => s + c.count, 0),
      chapters: chapters.sort((a, b) => a.chapter.localeCompare(b.chapter, 'ko', { numeric: true })),
    }))
    .sort((a, b) => a.textbook.localeCompare(b.textbook, 'ko', { numeric: true }));

  return NextResponse.json({ textbooks });
}
