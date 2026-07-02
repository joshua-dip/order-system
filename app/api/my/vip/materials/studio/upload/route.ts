import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { requireVipMenu } from '@/lib/vip-menu-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = 'uploads/vip-material-studio';
const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** POST multipart { file } — 편집기 이미지 업로드 → 본인 폴더에 저장, 서빙 URL 반환 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  try {
    const formData = await request.formData();
    const f = formData.get('file');
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    const file = f as File;
    if (file.size > MAX_SIZE) return NextResponse.json({ error: '이미지는 8MB 이하만 가능합니다.' }, { status: 400 });
    const ext = path.extname(file.name || '').toLowerCase() || '.png';
    if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: 'PNG·JPG·GIF·WEBP 이미지만 가능합니다.' }, { status: 400 });

    const dir = path.join(process.cwd(), UPLOAD_DIR, auth.userId);
    await fs.mkdir(dir, { recursive: true });
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ ok: true, url: `/api/my/vip/materials/studio/file/${auth.userId}/${name}` });
  } catch (e) {
    console.error('studio upload:', e);
    return NextResponse.json({ error: '업로드에 실패했습니다.' }, { status: 500 });
  }
}
