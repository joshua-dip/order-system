import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '@/lib/variant-draft-grammar-rules';

function serialize(doc: Record<string, unknown>) {
  const { _id, passage_id, ...rest } = doc;
  return {
    ...rest,
    _id: String(_id),
    passage_id: passage_id ? String(passage_id) : null,
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
    const doc = await db.collection('generated_questions').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ item: serialize(doc as Record<string, unknown>) });
  } catch (e) {
    console.error('generated-questions GET id:', e);
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
    const col = db.collection('generated_questions');
    const existing = await col.findOne({ _id: new ObjectId(id) });
    if (!existing) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

    const $set: Record<string, unknown> = { updated_at: new Date() };

    if (typeof body.textbook === 'string') $set.textbook = body.textbook.trim();
    if (typeof body.source === 'string') $set.source = body.source.trim();
    if (typeof body.type === 'string') $set.type = body.type.trim();
    if (typeof body.option_type === 'string') $set.option_type = body.option_type.trim();
    if (typeof body.difficulty === 'string') $set.difficulty = body.difficulty.trim();
    if (typeof body.status === 'string') $set.status = body.status.trim();
    if (body.error_msg !== undefined) {
      $set.error_msg =
        body.error_msg === null ? null : typeof body.error_msg === 'string' ? body.error_msg : String(body.error_msg);
    }
    if (typeof body.passage_id === 'string' && body.passage_id.trim() && ObjectId.isValid(body.passage_id.trim())) {
      $set.passage_id = new ObjectId(body.passage_id.trim());
    }

    if (body.question_data !== undefined) {
      if (body.question_data !== null && typeof body.question_data === 'object' && !Array.isArray(body.question_data)) {
        $set.question_data = body.question_data;
      }
    } else if (typeof body.question_data_json === 'string') {
      try {
        $set.question_data = JSON.parse(body.question_data_json) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'question_data JSON 형식이 올바르지 않습니다.' }, { status: 400 });
      }
    }

    if (
      $set.question_data &&
      typeof $set.question_data === 'object' &&
      !Array.isArray($set.question_data)
    ) {
      const effType =
        typeof $set.type === 'string'
          ? ($set.type as string).trim()
          : String(existing.type ?? '').trim();
      if (effType === '어법') {
        $set.question_data = {
          ...($set.question_data as Record<string, unknown>),
          Options: GRAMMAR_VARIANT_OPTIONS_FIXED,
        };
      }
    }

    await col.updateOne({ _id: new ObjectId(id) }, { $set });
    const updated = await col.findOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true, item: updated ? serialize(updated as Record<string, unknown>) : null });
  } catch (e) {
    console.error('generated-questions PATCH:', e);
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
    const r = await db.collection('generated_questions').deleteOne({ _id: new ObjectId(id) });
    if (r.deletedCount === 0) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('generated-questions DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
