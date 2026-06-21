import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireVip } from '@/lib/vip-auth';

export type VipTextbookType = '교과서' | '부교재' | '모의고사';

/** admin/passages 의 「교재 분류」와 동일한 모의고사 이름 패턴. */
const MOCK_EXAM_PATTERN = /^\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사|^\d{2}년\s+고[123]\s+영어모의고사/;
function isMockExamName(name: string): boolean {
  return MOCK_EXAM_PATTERN.test(name) || /영어모의고사$/.test(name);
}

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const db = await getDb('gomijoshua');
    const [passageTextbooks, gqTextbooks, typeMetaDoc] = await Promise.all([
      db.collection('passages').distinct('textbook'),
      db.collection('generated_questions').distinct('textbook'),
      // 관리자 수동 분류(교과서/부교재) — admin/passages 의 「교재 분류」가 저장하는 맵
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.collection('settings').findOne({ _id: 'textbookTypeMeta' } as any),
    ]);

    const tbSet = new Set<string>();
    for (const t of [...(passageTextbooks as string[]), ...(gqTextbooks as string[])]) {
      if (typeof t === 'string' && t.trim()) tbSet.add(t.trim());
    }
    const textbooks = [...tbSet].sort((a, b) => a.localeCompare(b, 'ko'));

    const typeMap =
      typeMetaDoc?.value && typeof typeMetaDoc.value === 'object'
        ? (typeMetaDoc.value as Record<string, string>)
        : {};

    // 교재별 분류: ① 관리자 수동(교과서/부교재) 우선 → ② 모의고사 이름 패턴 → ③ 부교재(기본)
    const types: Record<string, VipTextbookType> = {};
    for (const tb of textbooks) {
      const manual = typeMap[tb];
      if (manual === '교과서' || manual === '부교재') {
        types[tb] = manual;
      } else if (isMockExamName(tb)) {
        types[tb] = '모의고사';
      } else {
        types[tb] = '부교재';
      }
    }

    return NextResponse.json({ ok: true, textbooks, types });
  } catch (e) {
    console.error('vip textbooks:', e);
    return NextResponse.json({ ok: false, error: '교재 목록을 불러올 수 없습니다.' }, { status: 500 });
  }
}
