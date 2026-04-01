/**
 * 변형문제「풀기」— Anthropic 호출 및 정답 비교 (API·배치 검수 공용)
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildEnglishExamSolveUserPrompt } from '@/lib/generated-question-solve-prompt';

export function normalizeSolveAnswer(s: string) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function checkSolveCorrect(claudeAnswer: string, correctAnswer: string): boolean {
  const ca = normalizeSolveAnswer(correctAnswer);
  const ans = normalizeSolveAnswer(claudeAnswer);

  if (ans === ca) return true;
  if (ans.includes(ca) || ca.includes(ans)) return true;

  if (/^[1-5]$/.test(ca)) {
    const circled = ['①', '②', '③', '④', '⑤'];
    const circledMatch = circled[parseInt(ca, 10) - 1];
    if (ans.includes(circledMatch)) return true;
    const rx = new RegExp(`(?<![0-9])${ca}(?![0-9])`);
    if (rx.test(ans)) return true;
  }

  return false;
}

export type ClaudeSolveResult = {
  claudeAnswer: string;
  claudeResponse: string;
  correctAnswer: string | null;
  isCorrect: boolean | null;
  model: string;
};

export async function runClaudeSolveForQuestion(input: {
  question: string;
  paragraph: string;
  options: string;
  correctAnswer: string;
  questionType: string;
}): Promise<ClaudeSolveResult> {
  const question = input.question.trim();
  const paragraph = input.paragraph.trim();
  const options = input.options.trim();
  const correctAnswer = input.correctAnswer.trim();
  const questionType = input.questionType.trim();

  if (!question && !paragraph) {
    throw new Error('발문 또는 지문이 없습니다.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  const model =
    (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
    'claude-sonnet-4-6';

  const client = new Anthropic({ apiKey });
  const prompt = buildEnglishExamSolveUserPrompt({
    questionType,
    paragraph,
    question,
    options,
  });

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const answerMatch = responseText.match(/정답\s*[:：]\s*(.+?)(?:\n|$)/);
  const claudeAnswer = answerMatch ? answerMatch[1].trim() : responseText.split('\n')[0].trim();
  const isCorrect = correctAnswer ? checkSolveCorrect(claudeAnswer, correctAnswer) : null;

  return {
    claudeAnswer,
    claudeResponse: responseText,
    correctAnswer: correctAnswer || null,
    isCorrect,
    model,
  };
}
