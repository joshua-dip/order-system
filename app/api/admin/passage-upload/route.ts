import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';

const ALLOWED_EXT = ['.xlsx', '.xls'];

function sanitizeFileName(name: string): string {
  const base = path.basename(name);
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return '';
  const withoutExt = path.basename(base, ext).replace(/[^a-zA-Z0-9가-힣._\s()-]/g, '_').slice(0, 120);
  return withoutExt + ext;
}

/**
 * 관리자 전용: 교재 엑셀(.xlsx) 업로드 → converted_data.json에 병합
 * (기존 scripts/excel_to_json.py 로직 실행)
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: '엑셀 파일을 선택해 주세요.' }, { status: 400 });
    }

    const rawName = (file as File).name || 'upload.xlsx';
    const safeName = sanitizeFileName(rawName);
    if (!safeName) {
      return NextResponse.json({ error: '.xlsx 또는 .xls 파일만 업로드할 수 있습니다.' }, { status: 400 });
    }

    const assetsDir = path.join(process.cwd(), 'assets');
    await fs.mkdir(assetsDir, { recursive: true });
    const savePath = path.join(assetsDir, safeName);
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    await fs.writeFile(savePath, buffer);

    const scriptPath = path.join(process.cwd(), 'scripts', 'excel_to_json.py');
    try {
      execSync(`python3 "${scriptPath}" "${savePath}"`, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });
    } catch (execErr) {
      const msg = execErr instanceof Error ? execErr.message : String(execErr);
      return NextResponse.json({
        error: '엑셀 변환에 실패했습니다. 열 구조(교재/강·회차/번호)를 확인해 주세요.',
        detail: msg.slice(0, 300),
      }, { status: 400 });
    }

    const textbookName = path.basename(safeName, path.extname(safeName));
    return NextResponse.json({ ok: true, textbookName });
  } catch (err) {
    console.error('지문 업로드 실패:', err);
    return NextResponse.json({ error: '업로드 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
