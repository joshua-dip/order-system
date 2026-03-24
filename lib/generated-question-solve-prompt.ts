/**
 * 관리자「풀기」— Claude API / ChatGPT 웹 공통 사용자 프롬프트.
 * (정답·해설은 넣지 않음 — 독립 풀이용)
 */
export function buildEnglishExamSolveUserPrompt(opts: {
  questionType?: string;
  paragraph?: string;
  question?: string;
  options?: string;
}): string {
  const questionType = (opts.questionType ?? '').replace(/\s+/g, ' ').trim();
  const paragraph = (opts.paragraph ?? '').replace(/\s+/g, ' ').trim();
  const question = (opts.question ?? '').replace(/\s+/g, ' ').trim();
  const options = (opts.options ?? '').replace(/\s+/g, ' ').trim();

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

  return prompt;
}
