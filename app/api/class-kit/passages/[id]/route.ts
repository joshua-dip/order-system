import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  classKitTextbookDeniedMessage,
  isClassKitTextbookAllowed,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';

/**
 * 사용자용 — 단건 passage 조회.
 * 비-관리자(회원·게스트)는 passage.textbook 이 모의고사 키여야만 응답.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 id 형식입니다.' }, { status: 400 });
  }

  const { level } = await resolveClassKitAccess(request);

  try {
    const db = await getDb('gomijoshua');
    const doc = await db
      .collection('passages')
      .findOne(
        { _id: new ObjectId(id) },
        {
          projection: {
            textbook: 1,
            chapter: 1,
            number: 1,
            source_key: 1,
            'content.original': 1,
            'content.sentences_en': 1,
            'content.sentences_ko': 1,
          },
        },
      );
    if (!doc) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }
    const tb = String((doc as { textbook?: unknown }).textbook ?? '');
    if (!isClassKitTextbookAllowed(tb, level)) {
      return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
    }
    const { _id, ...rest } = doc as Record<string, unknown>;
    return NextResponse.json({ item: { ...rest, _id: String(_id) } });
  } catch (e) {
    console.error('class-kit passage:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
