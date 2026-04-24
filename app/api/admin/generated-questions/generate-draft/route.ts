import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import { generateWorkbookGrammarQuestion } from '@/lib/workbook-grammar-claude';

/** Vercel 등: Claude 응답이 길 수 있음. Pro에서 maxDuration 적용. Hobby(10초)는 타임아웃 가능 */
export const maxDuration = 120;

/**
 * passages 원문 + 유형으로 Claude가 question_data JSON 초안만 생성 (DB 저장 없음).
 * 새 변형문제 모달에서 사용.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    const userHint = typeof body.userHint === 'string' ? body.userHint.trim().slice(0, 2000) : '';
    const typePrompt =
      typeof body.typePrompt === 'string' ? body.typePrompt.trim().slice(0, 12000) : '';
    const difficulty = typeof body.difficulty === 'string' ? body.difficulty.trim() : '중';

    if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '유효한 passage_id(ObjectId)가 필요합니다.' }, { status: 400 });
    }
    if (!textbook || !source || !type) {
      return NextResponse.json(
        { error: '교재명(textbook), 출처(source), 유형(type)은 필수입니다.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    const passage = await passagesCol.findOne({ _id: new ObjectId(passageIdStr) });
    if (!passage) {
      return NextResponse.json({ error: '원문 passage를 찾을 수 없습니다.' }, { status: 404 });
    }

    const pTextbook = String(passage.textbook ?? '').trim();
    if (pTextbook !== textbook) {
      return NextResponse.json(
        {
          error: `원문의 교재명("${pTextbook || '—'}")과 입력 교재명이 일치하지 않습니다.`,
        },
        { status: 400 }
      );
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

    if (!paragraph.trim()) {
      return NextResponse.json(
        { error: '원문에 영어 지문(content.original 등)이 없어 AI 초안을 만들 수 없습니다.' },
        { status: 400 }
      );
    }

    const passageOid = new ObjectId(passageIdStr);
    const maxAgg = await gqCol
      .aggregate<{ m: number | null }>([
        {
          $match: {
            textbook,
            passage_id: passageOid,
            source,
            type,
          },
        },
        { $group: { _id: null, m: { $max: '$question_data.NumQuestion' } } },
      ])
      .toArray();
    const prevMax = typeof maxAgg[0]?.m === 'number' && Number.isFinite(maxAgg[0].m) ? maxAgg[0].m : 0;
    const nextNum = prevMax + 1;

    // 워크북어법은 전용 생성 로직 사용
    if (type === '워크북어법') {
      const maxPoints =
        typeof body.maxPoints === 'number' ? Math.min(8, Math.max(1, body.maxPoints)) : 4;
      try {
        const wb = await generateWorkbookGrammarQuestion({ passage: paragraph, maxPoints });
        return NextResponse.json({
          ok: true,
          nextNum,
          question_data: wb.questionData,
          pointCount: wb.questionData.GrammarPoints.length,
        });
      } catch (wbErr) {
        const msg = wbErr instanceof Error ? wbErr.message : String(wbErr);
        return NextResponse.json({ error: msg }, { status: 422 });
      }
    }

    const ai = await generateVariantDraftQuestionDataWithClaude({
      paragraph,
      type,
      nextNum,
      userHint,
      typePrompt,
      difficulty,
    });

    if (!ai.ok) {
      const isKey = ai.error.includes('ANTHROPIC_API_KEY');
      return NextResponse.json({ error: ai.error }, { status: isKey ? 400 : 422 });
    }

    return NextResponse.json({
      ok: true,
      nextNum,
      question_data: ai.question_data,
    });
  } catch (e) {
    console.error('generate-draft:', e);
    return NextResponse.json({ error: '초안 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
