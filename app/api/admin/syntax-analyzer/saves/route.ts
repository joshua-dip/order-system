import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const COL = 'syntax_analyzer_saves';

function serialize(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    _id: String(_id),
    created_at:
      doc.created_at instanceof Date ? doc.created_at.toISOString() : (doc.created_at as string) ?? null,
    updated_at:
      doc.updated_at instanceof Date ? doc.updated_at.toISOString() : (doc.updated_at as string) ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  if (!payload) return NextResponse.json({ error: '인증 오류' }, { status: 401 });

  const limit = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50));

  try {
    const db = await getDb('gomijoshua');
    const items = await db
      .collection(COL)
      .find({})
      .sort({ updated_at: -1 })
      .limit(limit)
      .project({
        title: 1,
        loginId: 1,
        passage_id: 1,
        textbook: 1,
        source_label: 1,
        created_at: 1,
        updated_at: 1,
      })
      .toArray();

    return NextResponse.json({
      items: items.map((d) => serialize(d as Record<string, unknown>)),
    });
  } catch (e) {
    console.error('syntax-analyzer saves GET:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  if (!payload) return NextResponse.json({ error: '인증 오류' }, { status: 401 });

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const passage_id = typeof body.passage_id === 'string' ? body.passage_id.trim() : null;
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : null;
    const source_label = typeof body.source_label === 'string' ? body.source_label.trim() : '';
    const sentences = Array.isArray(body.sentences) ? body.sentences.map((s: unknown) => String(s)) : [];
    const hasSyntaxResult = Object.prototype.hasOwnProperty.call(body, 'syntax_result');
    const hasSvocResult = Object.prototype.hasOwnProperty.call(body, 'svoc_result');
    const idStr = typeof body._id === 'string' ? body._id.trim() : '';

    const db = await getDb('gomijoshua');
    const col = db.collection(COL);
    const now = new Date();

    if (idStr && ObjectId.isValid(idStr)) {
      const existing = await col.findOne({ _id: new ObjectId(idStr) });
      if (!existing) {
        return NextResponse.json({ error: '저장본을 찾을 수 없습니다.' }, { status: 404 });
      }
      const $set: Record<string, unknown> = {
        updated_at: now,
        sentences,
      };
      if (hasSyntaxResult) $set.syntax_result = body.syntax_result ?? null;
      if (hasSvocResult) $set.svoc_result = body.svoc_result ?? null;
      if (title) $set.title = title;
      if (passage_id !== undefined) $set.passage_id = passage_id;
      if (textbook !== undefined) $set.textbook = textbook;
      if (source_label !== undefined) $set.source_label = source_label;

      await col.updateOne({ _id: new ObjectId(idStr) }, { $set });
      const updated = await col.findOne({ _id: new ObjectId(idStr) });
      return NextResponse.json({ item: serialize(updated as Record<string, unknown>) });
    }

    const doc = {
      title: title || (source_label ? `구문분석 · ${source_label}` : '제목 없음'),
      loginId: payload.loginId,
      passage_id,
      textbook,
      source_label,
      sentences,
      syntax_result: hasSyntaxResult ? (body.syntax_result ?? null) : null,
      svoc_result: hasSvocResult ? (body.svoc_result ?? null) : null,
      created_at: now,
      updated_at: now,
    };

    const ins = await col.insertOne(doc);
    const created = await col.findOne({ _id: ins.insertedId });
    return NextResponse.json({ item: serialize(created as Record<string, unknown>) });
  } catch (e) {
    console.error('syntax-analyzer saves POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
