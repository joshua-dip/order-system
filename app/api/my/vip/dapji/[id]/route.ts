import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { DAPJI_FILES_COLLECTION, getFile, type DapjiFileDoc } from '@/lib/vip-dapji-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/my/vip/dapji/<id>[?download=1] — 본인 답지 파일 서빙 (열람/다운로드).
 * owner-scoped 만 — 공개 API 아님. 출판 교재 답지는 여기서만 접근된다.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'dapji');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const doc = await db.collection<DapjiFileDoc>(DAPJI_FILES_COLLECTION)
    .findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!doc) return NextResponse.json({ error: '답지를 찾을 수 없습니다.' }, { status: 404 });

  const buf = await getFile(db, doc.gridId);
  const download = request.nextUrl.searchParams.get('download') === '1';
  const asciiName = encodeURIComponent(doc.filename || 'dapji');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': doc.contentType || 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${asciiName}`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
