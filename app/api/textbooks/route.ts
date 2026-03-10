import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

/**
 * 교재 데이터(converted_data.json)를 API로 제공합니다.
 * 대용량 JSON을 번들에 포함하지 않아 ChunkLoadError를 방지합니다.
 */
export async function GET() {
  try {
    const jsonPath = path.join(process.cwd(), 'app', 'data', 'converted_data.json');
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch (err) {
    console.error('교재 데이터 로드 실패:', err);
    return NextResponse.json(
      { error: '교재 데이터를 불러올 수 없습니다.' },
      { status: 503 }
    );
  }
}
