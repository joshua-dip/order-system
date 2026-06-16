import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 호버 툴팁용 지문 내용 미리보기 (원문 + 해석, 한 줄 정리 후 길이 제한). */
function buildPreview(original?: string, translation?: string): string {
  const en = String(original ?? '').replace(/\s+/g, ' ').trim();
  const ko = String(translation ?? '').replace(/\s+/g, ' ').trim();
  const enP = en.length > 220 ? en.slice(0, 220) + '…' : en;
  const koP = ko.length > 160 ? ko.slice(0, 160) + '…' : ko;
  return [enP, koP].filter(Boolean).join('\n\n');
}

/**
 * 한 교재의 지문 목록(번호) — 엑셀 추출 모달에서 지문별로 골라 담는 용도.
 * GET /api/admin/passages/export-passages?textbook=<교재명>
 * 반환: { passages: [{ id, chapter, number, preview }] }  (강 → 번호 순 정렬)
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
    .project({ chapter: 1, number: 1, 'content.original': 1, 'content.translation': 1 })
    .limit(3000)
    .toArray();

  const passages = docs
    .map((d) => {
      const doc = d as { _id: unknown; chapter?: string; number?: string; content?: { original?: string; translation?: string } };
      return {
        id: String(doc._id),
        chapter: doc.chapter ?? '',
        number: doc.number ?? '',
        preview: buildPreview(doc.content?.original, doc.content?.translation),
      };
    })
    .sort((a, b) => {
      const c = String(a.chapter).localeCompare(String(b.chapter), 'ko', { numeric: true });
      if (c !== 0) return c;
      return String(a.number).localeCompare(String(b.number), 'ko', { numeric: true });
    });

  return NextResponse.json({ passages });
}
