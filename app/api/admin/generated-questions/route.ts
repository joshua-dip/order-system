import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

function serialize(doc: Record<string, unknown>) {
  const { _id, passage_id, ...rest } = doc;
  const out: Record<string, unknown> = {
    ...rest,
    _id: String(_id),
    passage_id: passage_id ? String(passage_id) : null,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
  return out;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const type = searchParams.get('type')?.trim() || '';
  const status = searchParams.get('status')?.trim() || '';
  const passageId = searchParams.get('passage_id')?.trim() || '';
  const q = searchParams.get('q')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = textbook;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (passageId && ObjectId.isValid(passageId)) {
    filter.passage_id = new ObjectId(passageId);
  }
  if (q) {
    const rx = escapeRegex(q);
    filter.$or = [
      { source: { $regex: rx, $options: 'i' } },
      { 'question_data.Question': { $regex: rx, $options: 'i' } },
      { 'question_data.Paragraph': { $regex: rx, $options: 'i' } },
      { 'question_data.Options': { $regex: rx, $options: 'i' } },
      { 'question_data.Explanation': { $regex: rx, $options: 'i' } },
      { 'question_data.Category': { $regex: rx, $options: 'i' } },
    ];
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const [total, items] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ textbook: 1, source: 1, type: 1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .project({
          textbook: 1,
          passage_id: 1,
          source: 1,
          type: 1,
          option_type: 1,
          created_at: 1,
          'question_data.Question': 1,
          'question_data.Paragraph': 1,
          'question_data.NumQuestion': 1,
          'question_data.Category': 1,
          'question_data.Options': 1,
          'question_data.Explanation': 1,
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
    console.error('generated-questions GET:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : '';

    if (!textbook || !passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '교재명과 유효한 passage_id(ObjectId)는 필수입니다.' }, { status: 400 });
    }
    if (!source || !type) {
      return NextResponse.json({ error: 'source(출처)와 유형(type)은 필수입니다.' }, { status: 400 });
    }

    let question_data: Record<string, unknown> = {};
    if (body.question_data && typeof body.question_data === 'object' && !Array.isArray(body.question_data)) {
      question_data = body.question_data as Record<string, unknown>;
    } else if (typeof body.question_data_json === 'string' && body.question_data_json.trim()) {
      try {
        question_data = JSON.parse(body.question_data_json) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'question_data JSON 형식이 올바르지 않습니다.' }, { status: 400 });
      }
    }

    const option_type = typeof body.option_type === 'string' ? body.option_type.trim() : 'English';
    const docStatus = typeof body.status === 'string' && body.status.trim() ? body.status.trim() : '완료';
    const error_msg =
      body.error_msg === null || body.error_msg === undefined
        ? null
        : typeof body.error_msg === 'string'
          ? body.error_msg
          : String(body.error_msg);

    const now = new Date();
    const doc = {
      textbook,
      passage_id: new ObjectId(passageIdStr),
      source,
      type,
      option_type,
      question_data,
      status: docStatus,
      error_msg,
      created_at: now,
      updated_at: now,
    };

    const db = await getDb('gomijoshua');
    const r = await db.collection('generated_questions').insertOne(doc);
    const inserted = await db.collection('generated_questions').findOne({ _id: r.insertedId });
    return NextResponse.json({
      ok: true,
      item: inserted ? serialize(inserted as Record<string, unknown>) : null,
    });
  } catch (e) {
    console.error('generated-questions POST:', e);
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 });
  }
}
