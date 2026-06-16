import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 본문(원문·해석) 부분 일치 검색 → 교재·강·번호. 엑셀 추출 모달에서 지문을 좁혀 찾는 용도.
 * body: { q: string, limit? }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { q?: unknown; limit?: unknown };
  try {
    body = (await request.json()) as { q?: unknown; limit?: unknown };
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const q = typeof body.q === 'string' ? body.q.trim() : '';
  if (q.length < 2) return NextResponse.json({ results: [] });
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const rx = new RegExp(escapeRegex(q), 'i');

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ $or: [{ 'content.original': rx }, { 'content.translation': rx }] })
    .project({ textbook: 1, chapter: 1, number: 1, 'content.original': 1, 'content.translation': 1 })
    .limit(limit)
    .maxTimeMS(8000)
    .toArray();

  const results = docs.map((d) => {
    const doc = d as { _id: unknown; textbook?: string; chapter?: string; number?: string; content?: { original?: string; translation?: string } };
    const orig = String(doc.content?.original ?? '');
    const tr = String(doc.content?.translation ?? '');
    const src = rx.test(orig) ? orig : tr;
    const idx = src.search(rx);
    const start = Math.max(0, idx - 30);
    const end = Math.min(src.length, idx + q.length + 60);
    const snippet =
      (start > 0 ? '…' : '') + src.slice(start, end).replace(/\s+/g, ' ').trim() + (end < src.length ? '…' : '');
    return {
      id: String(doc._id),
      textbook: doc.textbook ?? '',
      chapter: doc.chapter ?? '',
      number: doc.number ?? '',
      snippet,
    };
  });

  return NextResponse.json({ results });
}
