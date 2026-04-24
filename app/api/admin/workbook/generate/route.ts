import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { generateWorkbookGrammarQuestion } from '@/lib/workbook-grammar-claude';
import { saveGeneratedWorkbook } from '@/lib/generated-workbooks-store';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';

    if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '유효한 passage_id 가 필요합니다.' }, { status: 400 });
    }

    const maxPoints =
      typeof body.maxPoints === 'number' ? Math.min(8, Math.max(1, body.maxPoints)) : 4;

    const db = await getDb('gomijoshua');
    const passage = await db.collection('passages').findOne({ _id: new ObjectId(passageIdStr) });
    if (!passage) {
      return NextResponse.json({ error: '원문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const content =
      passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
        ? (passage.content as Record<string, unknown>)
        : {};
    const paragraph =
      (typeof content.original === 'string' && content.original.trim()) ||
      (typeof content.mixed === 'string' && content.mixed.trim()) ||
      (typeof content.translation === 'string' && content.translation.trim()) ||
      '';

    if (!paragraph) {
      return NextResponse.json(
        { error: '원문에 영어 지문이 없어 AI 생성이 불가합니다.' },
        { status: 400 },
      );
    }

    const wb = await generateWorkbookGrammarQuestion({ passage: paragraph, maxPoints });

    const idempotencyKey = request.headers.get('x-idempotency-key')?.trim();
    if (idempotencyKey) {
      const existing = await db.collection('generated_workbooks').findOne({
        passage_id: new ObjectId(passageIdStr),
        _idempotency_key: idempotencyKey,
        deleted_at: null,
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          inserted_id: String(existing._id),
          duplicate: true,
          question_data: wb.questionData,
        });
      }
    }

    const parentId = typeof body.parent_id === 'string' ? body.parent_id.trim() : undefined;

    const saved = await saveGeneratedWorkbook(
      {
        passage_id: passageIdStr,
        textbook: String(passage.textbook ?? ''),
        passage_source_label: String(passage.source ?? ''),
        category: '워크북어법',
        paragraph: wb.questionData.Paragraph,
        grammar_points: wb.questionData.GrammarPoints,
        answer_text: wb.questionData.AnswerText,
        explanation: wb.questionData.Explanation,
        truncated_points_count: wb.truncatedCount ?? null,
        created_by: 'admin',
        parent_id: parentId,
      },
      db,
    );

    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      inserted_id: saved.inserted_id,
      question_data: wb.questionData,
      pointCount: wb.questionData.GrammarPoints.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '생성 중 오류';
    console.error('workbook/generate:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
