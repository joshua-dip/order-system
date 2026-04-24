import { NextRequest, NextResponse } from 'next/server';
import { requireStudent } from '@/lib/student-auth';
import { checkQuota, recordUsage } from '@/lib/student-ai-quota';
import { generateStudentQuestion, isStudentQuestionType } from '@/lib/student-ai-claude';

export const maxDuration = 60;

const PARAGRAPH_MAX_LEN = 3000;
const PARAGRAPH_MIN_LEN = 100;

export async function POST(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const paragraph = typeof body.paragraph === 'string' ? body.paragraph.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : undefined;

  if (paragraph.length < PARAGRAPH_MIN_LEN) {
    return NextResponse.json({ error: `지문은 ${PARAGRAPH_MIN_LEN}자 이상 입력해 주세요.` }, { status: 400 });
  }
  if (paragraph.length > PARAGRAPH_MAX_LEN) {
    return NextResponse.json({ error: `지문은 ${PARAGRAPH_MAX_LEN}자 이하로 입력해 주세요.` }, { status: 413 });
  }
  if (!type || !isStudentQuestionType(type)) {
    return NextResponse.json({ error: '유효한 문제 유형이 필요합니다.' }, { status: 400 });
  }

  const loginId = payload!.loginId;
  const quotaResult = await checkQuota(loginId);
  if (!quotaResult.ok) {
    return NextResponse.json(
      {
        error:
          quotaResult.reason === 'daily'
            ? `오늘 사용 가능 횟수(${quotaResult.dailyLimit}회)를 모두 썼어요. 내일 자정에 초기화돼요.`
            : `이번 주 사용 가능 횟수(${quotaResult.weeklyLimit}회)를 모두 썼어요.`,
        resetAt: quotaResult.resetAt.toISOString(),
      },
      { status: 429 }
    );
  }

  const result = await generateStudentQuestion({ paragraph, type: type as never, grade });

  await recordUsage({
    studentLoginId: loginId,
    kind: 'generate',
    ok: result.ok,
    questionType: type,
    inputTokens: result.ok ? result.inputTokens : undefined,
    outputTokens: result.ok ? result.outputTokens : undefined,
    errorMessage: !result.ok ? result.error : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, question_data: result.question_data, type: result.type });
}
