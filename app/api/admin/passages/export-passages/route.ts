import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 한 교재의 지문 목록(번호) — 엑셀 추출 모달에서 지문별로 골라 담는 용도.
 * GET /api/admin/passages/export-passages?textbook=<교재명>
 * 반환: { passages: [{ id, chapter, number }] }  (강 → 번호 순 정렬)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = (request.nextUrl.searchParams.get('textbook') ?? '').trim();
  if (!textbook) {
    return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook })
    .project({ chapter: 1, number: 1 })
    .limit(3000)
    .toArray();

  const passages = docs
    .map((d) => {
      const doc = d as { _id: unknown; chapter?: string; number?: string };
      return { id: String(doc._id), chapter: doc.chapter ?? '', number: doc.number ?? '' };
    })
    .sort((a, b) => {
      const c = String(a.chapter).localeCompare(String(b.chapter), 'ko', { numeric: true });
      if (c !== 0) return c;
      return String(a.number).localeCompare(String(b.number), 'ko', { numeric: true });
    });

  return NextResponse.json({ passages });
}
