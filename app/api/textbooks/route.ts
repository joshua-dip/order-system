import { NextResponse } from 'next/server';
import { readMergedConvertedData } from '@/lib/converted-data-store';

/**
 * 교재 병합 데이터를 API로 제공합니다.
 * — 관리자가 반영한 내용은 MongoDB `converted_textbook_json` 우선,
 * — 없으면 저장소의 converted_data.json (기본 번들).
 */
export async function GET() {
  try {
    const data = await readMergedConvertedData();
    return NextResponse.json(data);
  } catch (err) {
    console.error('교재 데이터 로드 실패:', err);
    return NextResponse.json(
      { error: '교재 데이터를 불러올 수 없습니다.' },
      { status: 503 }
    );
  }
}
