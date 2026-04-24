import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('passages').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ item: serialize(doc as Record<string, unknown>) });
  } catch (e) {
    console.error('passages GET id:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const existing = await col.findOne({ _id: new ObjectId(id) });
    if (!existing) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    const $set: Record<string, unknown> = { updated_at: new Date() };

    const VALID_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;
    type Publisher = typeof VALID_PUBLISHERS[number];

    if (typeof body.textbook === 'string') $set.textbook = body.textbook.trim();
    if (typeof body.chapter === 'string') $set.chapter = body.chapter.trim();
    if (typeof body.number === 'string') $set.number = body.number.trim();
    if (typeof body.source_key === 'string') $set.source_key = body.source_key.trim();
    if (typeof body.passage_source === 'string') $set.passage_source = body.passage_source.trim();
    if (body.publisher !== undefined) {
      const p = typeof body.publisher === 'string' ? body.publisher.trim() : '';
      $set.publisher = VALID_PUBLISHERS.includes(p as Publisher) ? (p as Publisher) : null;
    }
    if (body.page !== undefined) {
      const p =
        typeof body.page === 'number'
          ? body.page
          : typeof body.page === 'string'
            ? parseInt(body.page, 10)
            : undefined;
      if (p !== undefined && !Number.isNaN(p)) $set.page = p;
    }
    if (typeof body.page_label === 'string') $set.page_label = body.page_label.trim();
    if (body.order !== undefined) {
      const o =
        typeof body.order === 'number'
          ? body.order
          : typeof body.order === 'string'
            ? parseInt(body.order, 10)
            : 0;
      $set.order = Number.isNaN(o) ? 0 : o;
    }

    const prev = (existing.content as Record<string, unknown>) || {};
    if (
      typeof body.original === 'string' ||
      typeof body.translation === 'string' ||
      body.content !== undefined
    ) {
      const merged = body.content && typeof body.content === 'object' ? { ...prev, ...body.content } : { ...prev };
      if (typeof body.original === 'string') merged.original = body.original;
      if (typeof body.translation === 'string') merged.translation = body.translation;
      $set.content = {
        original: String(merged.original ?? ''),
        translation: String(merged.translation ?? ''),
        sentences_en: Array.isArray(merged.sentences_en) ? merged.sentences_en : [],
        sentences_ko: Array.isArray(merged.sentences_ko) ? merged.sentences_ko : [],
        tokenized_en: typeof merged.tokenized_en === 'string' ? merged.tokenized_en : '',
        tokenized_ko: typeof merged.tokenized_ko === 'string' ? merged.tokenized_ko : '',
        mixed: typeof merged.mixed === 'string' ? merged.mixed : '',
      };
    }

    await col.updateOne({ _id: new ObjectId(id) }, { $set });
    const updated = await col.findOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true, item: updated ? serialize(updated as Record<string, unknown>) : null });
  } catch (e) {
    console.error('passages PATCH:', e);
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const r = await db.collection('passages').deleteOne({ _id: new ObjectId(id) });
    if (r.deletedCount === 0) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('passages DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
