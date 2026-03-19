import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

function serialize(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    _id: String(_id),
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const chapter = searchParams.get('chapter')?.trim() || '';
  const q = searchParams.get('q')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = textbook;
  if (chapter) filter.chapter = { $regex: chapter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (q) {
    filter.$or = [
      { number: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { source_key: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { 'content.original': { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const [total, items] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ textbook: 1, chapter: 1, order: 1, number: 1 })
        .skip(skip)
        .limit(limit)
        .project({
          textbook: 1,
          chapter: 1,
          number: 1,
          source_key: 1,
          page: 1,
          page_label: 1,
          order: 1,
          'content.original': 1,
          created_at: 1,
          updated_at: 1,
        })
        .toArray(),
    ]);

    return NextResponse.json({
      items: items.map((d) => serialize(d as Record<string, unknown>)),
      total,
      page,
      limit,
    });
  } catch (e) {
    console.error('passages GET:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

function buildContent(body: Record<string, unknown>) {
  const existing = (body.content as Record<string, unknown> | undefined) || {};
  const original = typeof body.original === 'string' ? body.original : String(existing.original ?? '');
  const translation =
    typeof body.translation === 'string' ? body.translation : String(existing.translation ?? '');
  return {
    original,
    translation,
    sentences_en: Array.isArray(existing.sentences_en) ? existing.sentences_en : [],
    sentences_ko: Array.isArray(existing.sentences_ko) ? existing.sentences_ko : [],
    tokenized_en: typeof existing.tokenized_en === 'string' ? existing.tokenized_en : '',
    tokenized_ko: typeof existing.tokenized_ko === 'string' ? existing.tokenized_ko : '',
    mixed: typeof existing.mixed === 'string' ? existing.mixed : '',
  };
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : '';
    const number = typeof body.number === 'string' ? body.number.trim() : '';
    if (!textbook || !chapter || !number) {
      return NextResponse.json({ error: '교재명, 강(회차), 번호는 필수입니다.' }, { status: 400 });
    }

    const source_key =
      typeof body.source_key === 'string' && body.source_key.trim()
        ? body.source_key.trim()
        : `${chapter} ${number}`;
    const pageNum =
      typeof body.page === 'number' && !Number.isNaN(body.page)
        ? body.page
        : typeof body.page === 'string'
          ? parseInt(body.page, 10)
          : undefined;
    const page_label = typeof body.page_label === 'string' ? body.page_label.trim() : '';
    const order =
      typeof body.order === 'number' && !Number.isNaN(body.order)
        ? body.order
        : typeof body.order === 'string'
          ? parseInt(body.order, 10) || 0
          : 0;

    const now = new Date();
    const doc = {
      textbook,
      chapter,
      number,
      source_key,
      page: pageNum,
      page_label: page_label || undefined,
      order,
      content: buildContent(body),
      created_at: now,
      updated_at: now,
    };

    const db = await getDb('gomijoshua');
    const r = await db.collection('passages').insertOne(doc);
    const inserted = await db.collection('passages').findOne({ _id: r.insertedId });
    return NextResponse.json({ ok: true, item: inserted ? serialize(inserted as Record<string, unknown>) : null });
  } catch (e) {
    console.error('passages POST:', e);
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 });
  }
}
