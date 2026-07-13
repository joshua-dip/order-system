import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION } from '@/lib/vip-material-studio';
import { renderStudioDocToPdf } from '@/lib/vip-material-studio-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '유효하지 않은 ID' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const doc = await db.collection(STUDIO_MATERIALS_COLLECTION).findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!doc) return NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 });

  // 이미지 요소는 이 사용자 소유의 업로드 파일만 렌더 (경로 스푸핑 차단)
  const resolveImage = (src: string): Buffer | null => {
    const m = src.match(/\/file\/([a-f0-9]{24})\/([^/?]+)$/);
    if (!m || m[1] !== auth.userId) return null;
    const fp = path.join(process.cwd(), 'uploads/vip-material-studio', m[1], path.basename(m[2]));
    return fs.existsSync(fp) ? fs.readFileSync(fp) : null;
  };

  const buf = await renderStudioDocToPdf(doc as { title?: string; pages?: unknown }, { resolveImage });

  const fname = encodeURIComponent(`${doc.title || '교재'}.pdf`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
    },
  });
}
