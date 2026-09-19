import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildSchoolTextbooksData, getSchoolTextbookKeysWithPassages } from '@/lib/school-textbooks';

/**
 * 교과서(쏠북 교재) 목록 + 트리 — **권한과 무관하게 모두에게** 내려준다.
 *
 * 예전엔 「교과서 주문 허용」(canOrderSchoolTextbook) 회원에게만 줘서, 권한이 꺼진 계정은
 * /gyogwaseo 에서 쏠북 등록분 5권만 보였다(관리자 계정 포함). 교과서 주문은 강·시험범위
 * 맞춤 제작이라 교재를 가려 둘 이유가 없다는 방침(2026-09-19)에 따라 전원 공개한다.
 *
 * `?keysOnly=1` — 교재 이름만. 목록 화면(LessonSelection)은 이름만 쓰므로 트리를 만들지 않는다.
 * 단원 목록은 교재를 고른 뒤 /api/textbooks/lesson-index 가 같은 지문으로 만들어 준다
 * (59권 전부 이 라우트의 트리와 항목이 같음을 확인).
 *
 * 워크북·분석지 화면의 교재 트리(/api/textbooks)는 여전히 권한 회원에게만 교과서를 얹는다 —
 * 허용목록 「미설정=전체」 회원에게 교과서가 한꺼번에 쏟아지지 않게 하려는 것으로, 이 방침과 별개다.
 */
export async function GET(request: NextRequest) {
  const empty = { keys: [] as string[], data: {} as Record<string, unknown> };
  try {
    const db = await getDb('gomijoshua');
    if (request.nextUrl.searchParams.get('keysOnly') === '1') {
      return NextResponse.json({ keys: await getSchoolTextbookKeysWithPassages(db), data: {} });
    }
    const result = await buildSchoolTextbooksData(db);
    return NextResponse.json(result);
  } catch (e) {
    console.error('교과서 교재 로드 실패:', e);
    return NextResponse.json(empty);
  }
}
