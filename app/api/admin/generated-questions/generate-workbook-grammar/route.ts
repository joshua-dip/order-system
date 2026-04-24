import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { generateWorkbookGrammarQuestion } from '@/lib/workbook-grammar-claude';

export const maxDuration = 120;

/**
 * 지문 + 어법 포인트 수 → 워크북 어법 question_data 초안 생성 (DB 저장 없음).
 * Body: { passage_id, textbook, source, maxPoints?, skipExplanation? }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const maxPoints =
      typeof body.maxPoints === 'number' ? Math.min(8, Math.max(1, body.maxPoints)) : 4;
    const skipExplanation = body.skipExplanation === true;

    if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '유효한 passage_id가 필요합니다.' }, { status: 400 });
    }
    if (!textbook || !source) {
      return NextResponse.json({ error: 'textbook, source는 필수입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const passage = await db.collection('passages').findOne({ _id: new ObjectId(passageIdStr) });
    if (!passage) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const paragraphText = String(passage.paragraph ?? passage.Paragraph ?? '').trim();
    if (!paragraphText) {
      return NextResponse.json({ error: '지문 원문이 비어있습니다.' }, { status: 400 });
    }

    const result = await generateWorkbookGrammarQuestion({
      passage: paragraphText,
      maxPoints,
      skipExplanation,
    });

    return NextResponse.json({
      question_data: result.questionData,
      rawPoints: result.rawPoints,
      pointCount: result.questionData.GrammarPoints.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[generate-workbook-grammar]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
