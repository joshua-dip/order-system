import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { saveGeneratedWorkbook } from '@/lib/generated-workbooks-store';
import type { WorkbookGrammarPoint } from '@/lib/workbook-grammar-types';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const passage_id = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';

    let questionData = body.question_data;
    if (!questionData && typeof body.question_data_json === 'string') {
      try {
        questionData = JSON.parse(body.question_data_json);
      } catch {
        return NextResponse.json({ error: 'question_data JSON 파싱 실패' }, { status: 400 });
      }
    }

    if (!passage_id || !textbook || !questionData) {
      return NextResponse.json(
        { error: 'passage_id, textbook, question_data 가 필요합니다.' },
        { status: 400 },
      );
    }

    const qd = questionData as Record<string, unknown>;
    const result = await saveGeneratedWorkbook({
      passage_id,
      textbook,
      passage_source_label: source || undefined,
      category: '워크북어법',
      paragraph: String(qd.Paragraph ?? ''),
      grammar_points: (qd.GrammarPoints ?? []) as WorkbookGrammarPoint[],
      answer_text: String(qd.AnswerText ?? ''),
      explanation: String(qd.Explanation ?? ''),
      truncated_points_count: typeof qd._truncatedCount === 'number' ? qd._truncatedCount : null,
      created_by: 'admin',
      status: typeof body.status === 'string' && body.status === 'reviewed' ? 'reviewed' : 'draft',
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, inserted_id: result.inserted_id });
  } catch (e) {
    console.error('workbook/save POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
