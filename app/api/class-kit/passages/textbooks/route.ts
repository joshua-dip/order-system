import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  CLASS_KIT_GUEST_NOTICE,
  CLASS_KIT_MEMBER_NOTICE,
  filterClassKitTextbooks,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';

/**
 * 사용자용 — 클래스키트에서 쓸 수 있는 교재 목록.
 * - 비회원: 26년 6월 고1·고2·고3 모의고사만
 * - 회원(정회원 포함): 모의고사 전체
 * - 관리자: 전체 교재
 */
export async function GET(request: NextRequest) {
  const { level } = await resolveClassKitAccess(request);

  try {
    const db = await getDb('gomijoshua');
    const all = (await db.collection('passages').distinct('textbook')) as string[];
    const filtered = filterClassKitTextbooks(all.filter(Boolean), level).sort((a, b) =>
      a.localeCompare(b, 'ko'),
    );
    return NextResponse.json({
      textbooks: filtered,
      accessLevel: level,
      guest: level === 'guest',
      notice:
        level === 'guest'
          ? CLASS_KIT_GUEST_NOTICE
          : level === 'member'
            ? CLASS_KIT_MEMBER_NOTICE
            : null,
    });
  } catch (e) {
    console.error('class-kit textbooks:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
