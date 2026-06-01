/**
 * 변형문제「풀기」— Anthropic 호출 및 정답 비교 (API·배치 검수 공용)
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildEnglishExamSolveUserPrompt } from '@/lib/generated-question-solve-prompt';

export function normalizeSolveAnswer(s: string) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤'] as const;

/**
 * 문자열에서 동그라미 번호(또는 1~5 숫자)를 set 으로 추출.
 * 예: "①③" → {1,3}, "①, ③, ⑤" → {1,3,5}, "1 and 3" → {1,3}
 */
function extractCircledNumberSet(s: string): Set<number> {
  const out = new Set<number>();
  for (const ch of s) {
    const idx = (CIRCLED_DIGITS as readonly string[]).indexOf(ch);
    if (idx >= 0) out.add(idx + 1);
    if (/^[1-5]$/.test(ch)) out.add(parseInt(ch, 10));
  }
  return out;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function checkSolveCorrect(claudeAnswer: string, correctAnswer: string): boolean {
  const ca = normalizeSolveAnswer(correctAnswer);
  const ans = normalizeSolveAnswer(claudeAnswer);

  // 어법-고난도 등 복수 답: 동그라미 번호 2개 이상이면 set 동등 비교
  const caSet = extractCircledNumberSet(ca);
  if (caSet.size >= 2) {
    const ansSet = extractCircledNumberSet(ans);
    return setsEqual(caSet, ansSet);
  }

  if (ans === ca) return true;
  if (ans.includes(ca) || ca.includes(ans)) return true;

  if (/^[1-5]$/.test(ca)) {
    const circledMatch = CIRCLED_DIGITS[parseInt(ca, 10) - 1];
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
