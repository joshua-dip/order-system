import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyzer_question_types';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const items = await db.collection(COL).find({}).sort({ order: 1 }).toArray();
    return NextResponse.json({
      types: items.map((t) => {
        const x = t as Record<string, unknown>;
        return {
          id: String(x.id ?? ''),
          label: typeof x.label === 'string' ? x.label : '',
          prompt: typeof x.prompt === 'string' ? x.prompt : '',
          order: typeof x.order === 'number' ? x.order : 0,
          isActive: x.isActive !== false,
        };
      }),
    });
  } catch (e) {
    console.error('question-types GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    }
    const label = typeof body.label === 'string' ? body.label.trim() : id;
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const order = typeof body.order === 'number' ? body.order : 0;
    const isActive = body.isActive !== false;

    const db = await getDb('gomijoshua');
    await db.collection(COL).updateOne(
      { id },
      {
        $set: { id, label, prompt, order, isActive, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('question-types POST:', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    await db.collection(COL).deleteOne({ id });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('question-types DELETE:', e);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
