import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { generateQuestionExplanationWithClaude } from '@/lib/generate-question-explanation-claude';

export const maxDuration = 120;

/**
 * 기존 question_data(지문·발문·선택지·정답)를 주고 Explanation(한국어 해설)만 생성.
 * 변형문제 수정 시 해설만 다시 만들 때 사용.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const questionData = body.question_data;
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    const userHint = typeof body.userHint === 'string' ? body.userHint.trim().slice(0, 2000) : '';

    if (!questionData || typeof questionData !== 'object' || Array.isArray(questionData)) {
      return NextResponse.json(
        { error: 'question_data 객체가 필요합니다.' },
        { status: 400 }
      );
    }

    const result = await generateQuestionExplanationWithClaude({
      questionData: questionData as Record<string, unknown>,
      type,
      userHint,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      explanation: result.explanation,
    });
  } catch (e) {
    console.error('generate-explanation:', e);
    return NextResponse.json(
      { error: '해설 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
