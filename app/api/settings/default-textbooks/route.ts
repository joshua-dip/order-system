import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * 부교재 주문제작 메뉴에서 비회원·전체에게 노출할 기본 교재 목록.
 * 비공개. 설정 없으면 빈 배열 (호출측에서 전체 노출 등 처리).
 */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await db.collection('settings').findOne({ _id: 'defaultTextbooks' } as any);
    const value = Array.isArray(doc?.value) ? doc.value : [];
    return NextResponse.json({ textbookKeys: value });
  } catch (err) {
    console.error('기본 노출 교재 조회 실패:', err);
    return NextResponse.json({ textbookKeys: [] });
  }
}
