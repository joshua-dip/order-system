import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';

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

    const q = questionData as Record<string, unknown>;
    const paragraph = typeof q.Paragraph === 'string' ? q.Paragraph : '';
    const question = typeof q.Question === 'string' ? q.Question : '';
    const options = typeof q.Options === 'string' ? q.Options : '';
    const correctAnswer = typeof q.CorrectAnswer === 'string' ? q.CorrectAnswer : '';
    const category = typeof q.Category === 'string' ? q.Category : type;

    if (!paragraph.trim()) {
      return NextResponse.json(
        { error: 'question_data.Paragraph가 비어 있으면 해설을 생성할 수 없습니다.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY 설정이 필요합니다.' },
        { status: 400 }
      );
    }

    const model =
      (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
      'claude-sonnet-4-6';

    const client = new Anthropic({ apiKey });
    const sys = `당신은 한국 수능 영어 변형문제 해설 작성자입니다.
주어진 지문(Paragraph), 발문(Question), 선택지(Options), 정답(CorrectAnswer)에 맞는 **한국어 해설(Explanation)**만 작성합니다.
다른 내용은 출력하지 말고, 해설 텍스트만 출력하세요. 마크다운·JSON·제목 없이 순수 텍스트로만 출력.

해설 규칙:
- 정답이 왜 맞는지 지문/선택지와 연결해 설명하고, 오답이 왜 틀린지 간단히 짚습니다.
- 순서/삽입 유형: "① 가 정답입니다."(또는 해당 번호)로 시작하고, 논리 흐름을 설명한 뒤 "논리 흐름 요약:" 한 문장으로 마침.
- 어법 유형: 틀린 번호로 시작해 해당 어법 오류 이유를 한국어로 설명.
- 그 외 유형: 지문 근거와 선택지 비교로 정답 근거를 명확히 제시.`;

    const userMsg = `유형(Category): ${category || type}
${userHint ? `추가 지시: ${userHint}\n\n` : ''}[Paragraph]
${paragraph}

[Question]
${question}

[Options]
${options}

[CorrectAnswer]
${correctAnswer}

위 문제에 대한 한국어 해설(Explanation)만 작성하세요.`;

    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    });
    const responseText =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    const explanation = (responseText || '').trim();

    if (!explanation) {
      return NextResponse.json(
        { error: 'AI가 해설을 생성하지 못했습니다.' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      explanation,
    });
  } catch (e) {
    console.error('generate-explanation:', e);
    return NextResponse.json(
      { error: '해설 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
