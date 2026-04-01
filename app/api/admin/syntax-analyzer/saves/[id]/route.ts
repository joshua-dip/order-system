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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COL).findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ item: serialize(doc as Record<string, unknown>) });
  } catch (e) {
    console.error('syntax-analyzer saves GET id:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
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
    const r = await db.collection(COL).deleteOne({ _id: new ObjectId(id) });
    if (r.deletedCount === 0) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('syntax-analyzer saves DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
