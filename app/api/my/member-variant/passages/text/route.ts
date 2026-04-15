import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  isAllowedMemberVariantPassageTextbook,
  isPassageDocTextbookAllowedForMemberVariant,
  passageMongoTextbookMatch,
} from '@/lib/member-variant-passage-sources';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

function sourceLabelFromDoc(doc: {
  source_key?: string;
  chapter?: string;
  number?: string;
}): string {
  const sk = typeof doc.source_key === 'string' ? doc.source_key.trim() : '';
  if (sk) return sk;
  const ch = typeof doc.chapter === 'string' ? doc.chapter.trim() : '';
  const num = typeof doc.number === 'string' ? doc.number.trim() : '';
  return [ch, num].filter(Boolean).join(' ').trim() || '지문';
}

export async function GET(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const passageId = sp.get('passage_id')?.trim() ?? '';
  const textbookParam = sp.get('textbook')?.trim() ?? '';
  const chapter = sp.get('chapter')?.trim() ?? '';
  const number = sp.get('number')?.trim() ?? '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');

    let doc: Record<string, unknown> | null = null;

    if (passageId && ObjectId.isValid(passageId)) {
      doc = (await col.findOne(
        { _id: new ObjectId(passageId) },
        { projection: { textbook: 1, chapter: 1, number: 1, source_key: 1, content: 1 } },
      )) as Record<string, unknown> | null;
    } else if (textbookParam && (chapter || number)) {
      if (!isAllowedMemberVariantPassageTextbook(textbookParam)) {
        return NextResponse.json({ error: '허용되지 않은 교재입니다.' }, { status: 403 });
      }
      const filter: Record<string, unknown> = {
        ...passageMongoTextbookMatch(textbookParam),
      };
      if (chapter) filter.chapter = chapter;
      if (number) filter.number = number;
      doc = (await col.findOne(filter, {
        projection: { textbook: 1, chapter: 1, number: 1, source_key: 1, content: 1 },
        sort: { order: 1 },
      })) as Record<string, unknown> | null;
    } else {
      return NextResponse.json(
        { error: 'passage_id 또는 textbook+chapter(+number)가 필요합니다.' },
        { status: 400 },
      );
    }

    if (!doc?._id) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const tb = typeof doc.textbook === 'string' ? doc.textbook.trim() : '';
    if (!isPassageDocTextbookAllowedForMemberVariant(tb)) {
      return NextResponse.json({ error: '이 지문은 불러올 수 없습니다.' }, { status: 403 });
    }

    const content = doc.content as { original?: string } | undefined;
    const paragraph = typeof content?.original === 'string' ? content.original : '';
    if (!paragraph.trim()) {
      return NextResponse.json({ error: '지문 본문이 비어 있습니다.' }, { status: 422 });
    }

    const source = sourceLabelFromDoc({
      source_key: doc.source_key as string | undefined,
      chapter: doc.chapter as string | undefined,
      number: doc.number as string | undefined,
    });

    return NextResponse.json({
      ok: true,
      passage_id: String(doc._id),
      textbook: tb,
      source,
      paragraph,
    });
  } catch (e) {
    console.error('member-variant passages text:', e);
    return NextResponse.json({ error: '지문을 불러오지 못했습니다.' }, { status: 500 });
  }
}
