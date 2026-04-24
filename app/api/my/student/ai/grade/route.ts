import { NextRequest, NextResponse } from 'next/server';
import { requireStudent } from '@/lib/student-auth';
import { checkQuota, recordUsage } from '@/lib/student-ai-quota';
import { gradeStudentAnswer, isStudentQuestionType } from '@/lib/student-ai-claude';
import { recordAttempt } from '@/lib/student-attempts-store';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const question_data = typeof body.question_data === 'object' && body.question_data !== null
    ? (body.question_data as Record<string, unknown>)
    : null;
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const studentAnswer = typeof body.studentAnswer === 'string' ? body.studentAnswer.trim() : '';
  const timeSpentMs = typeof body.timeSpentMs === 'number' ? body.timeSpentMs : undefined;

  if (!question_data) return NextResponse.json({ error: '문제 데이터가 필요합니다.' }, { status: 400 });
  if (!type || !isStudentQuestionType(type)) return NextResponse.json({ error: '유효한 문제 유형이 필요합니다.' }, { status: 400 });
  if (!studentAnswer) return NextResponse.json({ error: '답안을 입력해 주세요.' }, { status: 400 });

  const loginId = payload!.loginId;
  const quotaResult = await checkQuota(loginId);
  if (!quotaResult.ok) {
    return NextResponse.json(
      { error: '오늘 AI 사용 횟수를 모두 소진했습니다.', resetAt: quotaResult.resetAt.toISOString() },
      { status: 429 }
    );
  }

  const result = await gradeStudentAnswer({ question_data, type: type as never, studentAnswer });

  await recordUsage({
    studentLoginId: loginId,
    kind: 'grade',
    ok: result.ok,
    questionType: type,
    inputTokens: result.ok ? result.inputTokens : undefined,
    outputTokens: result.ok ? result.outputTokens : undefined,
    errorMessage: !result.ok ? result.error : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // 풀이 기록 저장
  await recordAttempt({
    studentLoginId: loginId,
    questionData: question_data,
    questionType: type,
    studentAnswer,
    isCorrect: result.isCorrect,
    aiFeedback: result.feedback,
    timeSpentMs,
  });

  return NextResponse.json({ ok: true, isCorrect: result.isCorrect, feedback: result.feedback });
}
