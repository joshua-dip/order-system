import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';

function normalize(s: string) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function checkCorrect(claudeAnswer: string, correctAnswer: string): boolean {
  const ca = normalize(correctAnswer);
  const ans = normalize(claudeAnswer);

  // Direct match
  if (ans === ca) return true;
  if (ans.includes(ca) || ca.includes(ans)) return true;

  // Numeric: correctAnswer is "1"~"5", look for that digit in Claude's answer
  if (/^[1-5]$/.test(ca)) {
    // e.g. "정답: 3", "①", "번호 3번", etc.
    const circled = ['①', '②', '③', '④', '⑤'];
    const circledMatch = circled[parseInt(ca) - 1];
    if (ans.includes(circledMatch)) return true;
    // Look for the digit preceded/followed by word boundary-ish chars
    const rx = new RegExp(`(?<![0-9])${ca}(?![0-9])`);
    if (rx.test(ans)) return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

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

    const client = new Anthropic({ apiKey });
    /** 콘솔(https://console.anthropic.com/)·.env.example 의 ANTHROPIC_SOLVE_MODEL 참고 */
    const model =
      (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
      'claude-sonnet-4-6';

    let prompt = '당신은 한국 수능 영어 전문가입니다. 아래 문제를 풀고 정답을 맞혀주세요.\n\n';

    if (questionType) {
      prompt += `문제 유형: ${questionType}\n\n`;
    }

    if (paragraph) {
      prompt += `[지문]\n${paragraph}\n\n`;
    }

    if (question) {
      prompt += `[발문]\n${question}\n\n`;
    }

    if (options) {
      prompt += `[선택지]\n${options}\n\n`;
    }

    prompt +=
      '위 문제의 정답을 선택하고, 이유를 한국어로 간략히 설명해 주세요.\n반드시 "정답: [번호 또는 내용]" 형식으로 시작하세요.';

    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Extract "정답: ..." from response
    const answerMatch = responseText.match(/정답\s*[:：]\s*(.+?)(?:\n|$)/);
    const claudeAnswer = answerMatch ? answerMatch[1].trim() : responseText.split('\n')[0].trim();

    const isCorrect = correctAnswer ? checkCorrect(claudeAnswer, correctAnswer) : null;

    return NextResponse.json({
      ok: true,
      claudeAnswer,
      claudeResponse: responseText,
      correctAnswer: correctAnswer || null,
      isCorrect,
    });
  } catch (e) {
    console.error('generated-questions solve:', e);
    return NextResponse.json({ error: '풀기 요청 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
