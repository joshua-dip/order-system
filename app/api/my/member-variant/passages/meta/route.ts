import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  isAllowedMemberVariantPassageTextbook,
  passageMongoTextbookMatch,
} from '@/lib/member-variant-passage-sources';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

const META_LIMIT = 2500;

export async function GET(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() ?? '';
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 쿼리가 필요합니다.' }, { status: 400 });
  }
  if (!isAllowedMemberVariantPassageTextbook(textbook)) {
    return NextResponse.json(
      { error: '허용되지 않은 교재입니다. EBS 또는 모의고사만 선택할 수 있습니다.' },
      { status: 403 },
    );
  }

  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('passages')
      .find(passageMongoTextbookMatch(textbook))
      .project({ _id: 1, chapter: 1, number: 1, source_key: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(META_LIMIT)
      .toArray();

    const items = rows.map((d) => ({
      id: String(d._id),
      chapter: typeof d.chapter === 'string' ? d.chapter : '',
      number: typeof d.number === 'string' ? d.number : '',
      source_key: typeof d.source_key === 'string' ? d.source_key : '',
      order: typeof d.order === 'number' ? d.order : null,
    }));

    return NextResponse.json({ ok: true, textbook, count: items.length, items });
  } catch (e) {
    console.error('member-variant passages meta:', e);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
