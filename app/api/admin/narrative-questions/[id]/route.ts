import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * narrative_questions 단건 조회 (관리자 · 서술형 목록 상세용)
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('narrative_questions').findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: '문항을 찾을 수 없습니다.' }, { status: 404 });
    }
    const d = doc as Record<string, unknown>;
    const item = {
      _id: String(d._id),
      textbook: String(d.textbook ?? ''),
      passage_id: d.passage_id ? String(d.passage_id) : '',
      source: String(d.source_key_matched ?? d.source_file ?? ''),
      type: String(d.narrative_subtype ?? ''),
      option_type: '서술형',
      status: String(d.excel_row_status ?? ''),
      question_data: d.question_data && typeof d.question_data === 'object' ? d.question_data : {},
      created_at: d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at ?? null,
      chapter: d.chapter ?? null,
      number: d.number ?? null,
      source_file: d.source_file ?? null,
      source_key_matched: d.source_key_matched ?? null,
      record_kind: 'narrative' as const,
    };
    return NextResponse.json({ item });
  } catch (e) {
    console.error('narrative-questions GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
