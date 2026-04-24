import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/** GET: assets/exam_kit/generation_prompt.md 내용 (시스템·조건 출제 프롬프트) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const kitDir = path.join(process.cwd(), 'assets/exam_kit');
    const prompt = fs.readFileSync(path.join(kitDir, 'generation_prompt.md'), 'utf-8');
    return NextResponse.json({ prompt });
  } catch (e) {
    console.error('[generation-prompt]', e);
    return NextResponse.json({ error: '프롬프트 파일을 읽을 수 없습니다.' }, { status: 500 });
  }
}
