import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { requireVip } from '@/lib/vip-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = 'uploads/vip-material-studio';
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

/** GET /file/<userId>/<name> — 본인 업로드 이미지 서빙 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ p: string[] }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { p } = await params;
  if (!Array.isArray(p) || p.length !== 2) return NextResponse.json({ error: 'bad path' }, { status: 400 });
  const [ownerId, rawName] = p;
  if (ownerId !== auth.userId) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  const name = path.basename(rawName); // 경로 탈출 방지
  const ext = path.extname(name).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return NextResponse.json({ error: 'bad type' }, { status: 400 });
  try {
    const buf = await fs.readFile(path.join(process.cwd(), UPLOAD_DIR, ownerId, name));
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=86400' },
    });
  } catch {
    return NextResponse.json({ error: '파일 없음' }, { status: 404 });
  }
}
