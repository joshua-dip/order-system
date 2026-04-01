import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { runClaudeSolveForQuestion } from '@/lib/generated-question-solve-core';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const paragraph = typeof body.paragraph === 'string' ? body.paragraph.trim() : '';
    const options = typeof body.options === 'string' ? body.options.trim() : '';
    const correctAnswer = typeof body.correctAnswer === 'string' ? body.correctAnswer.trim() : '';
    const questionType = typeof body.questionType === 'string' ? body.questionType.trim() : '';

    if (!question && !paragraph) {
      return NextResponse.json({ error: '발문 또는 지문이 없습니다.' }, { status: 400 });
    }

    const out = await runClaudeSolveForQuestion({
      question,
      paragraph,
      options,
      correctAnswer,
      questionType,
    });

    return NextResponse.json({
      ok: true,
      claudeAnswer: out.claudeAnswer,
      claudeResponse: out.claudeResponse,
      correctAnswer: out.correctAnswer,
      isCorrect: out.isCorrect,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '풀기 요청 중 오류가 발생했습니다.';
    const isKey = msg.includes('ANTHROPIC_API_KEY');
    console.error('generated-questions solve:', e);
    return NextResponse.json({ error: msg }, { status: isKey ? 500 : 500 });
  }
}
