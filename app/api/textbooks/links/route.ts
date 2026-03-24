import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { textbookLinksMapFromDb } from '@/lib/textbook-links-db';

/**
 * 교재명 → YES24/교보문고 등 링크 (MongoDB textbook_links, 최초 빈 DB 시 JSON 시드)
 */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    const map = await textbookLinksMapFromDb(db);
    return NextResponse.json(map);
  } catch (err) {
    console.error('교재 링크 로드 실패:', err);
    return NextResponse.json(
      { error: '교재 링크를 불러올 수 없습니다.' },
      { status: 503 }
    );
  }
}
