import Anthropic from '@anthropic-ai/sdk';

export type GenerateExplanationInput = {
  questionData: Record<string, unknown>;
  type: string;
  userHint?: string;
};

export type GenerateExplanationResult =
  | { ok: true; explanation: string }
  | { ok: false; error: string; status: number };

/**
 * 변형문제 question_data로 한국어 Explanation만 생성 (Claude).
 */
export async function generateQuestionExplanationWithClaude(
  input: GenerateExplanationInput
): Promise<GenerateExplanationResult> {
  const { questionData, type, userHint = '' } = input;
  const q = questionData;
  const paragraph = typeof q.Paragraph === 'string' ? q.Paragraph : '';
  const question = typeof q.Question === 'string' ? q.Question : '';
  const options = typeof q.Options === 'string' ? q.Options : '';
  const correctAnswer = typeof q.CorrectAnswer === 'string' ? q.CorrectAnswer : '';
  const category = typeof q.Category === 'string' ? q.Category : type;

  if (!paragraph.trim()) {
    return { ok: false, error: 'question_data.Paragraph가 비어 있으면 해설을 생성할 수 없습니다.', status: 400 };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY 설정이 필요합니다.', status: 500 };
  }

  const model =
    (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
    'claude-sonnet-4-6';

  const client = new Anthropic({ apiKey });
  const sys = `당신은 한국 수능 영어 변형문제 해설 작성자입니다.
주어진 지문(Paragraph), 발문(Question), 선택지(Options), 정답(CorrectAnswer)에 맞는 **한국어 해설(Explanation)**만 작성합니다.
다른 내용은 출력하지 말고, 해설 텍스트만 출력하세요. 마크다운·JSON·제목 없이 순수 텍스트로만 출력.

해설 규칙 (모든 유형 공통):
- **길이: 한국어 450자 이하**(대략 4~7문장). 핵심만. 다른 번호·보기를 두고 망설이다 결론을 바꾸는 **자기모순 서술 금지**.
- 정답이 왜 맞는지 지문/선택지와 연결해 설명하고, 오답은 필요하면 한두 문장으로만 짚습니다.
- 순서/삽입 유형: "① 가 정답입니다."로 시작, 흐름은 짧게, 마지막에 "논리 흐름 요약:" 한 문장.
- 어법 유형: 반드시 "② 가 정답입니다."처럼 **CorrectAnswer와 같은 번호로 시작** → **원문에서 맞는 표기(correctForm)**와 **지문에 실린 틀린 표기(wrongForm)**를 짚어 **2~3문장**. 다른 번호를 검토하며 길게 늘리지 말 것.
- 빈칸(빈칸추론) 유형: 첫 줄에 정답 동그라미번호와 정답 영문 선택지를 붙여 쓰고(예: ③ the ability to adapt to changing circumstances), 다음 줄에 *해설: 로 시작하는 한국어 문단(전체 450자 이하). 빈칸 앞뒤 문맥 중심, 다른 보기 일일이 논박 금지.
- 그 외 유형: 지문 근거와 정답 근거를 짧게 명확히.`;

  const hint = userHint.trim().slice(0, 2000);
  const userMsg = `유형(Category): ${category || type}
${hint ? `추가 지시: ${hint}\n\n` : ''}[Paragraph]
${paragraph}

[Question]
${question}

[Options]
${options}

[CorrectAnswer]
${correctAnswer}

위 문제에 대한 한국어 해설(Explanation)만 작성하세요.`;

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 900,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    });
    const responseText =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    const explanation = (responseText || '').trim();

    if (!explanation) {
      return { ok: false, error: 'AI가 해설을 생성하지 못했습니다.', status: 422 };
    }

    return { ok: true, explanation };
  } catch (e) {
    console.error('generateQuestionExplanationWithClaude:', e);
    return { ok: false, error: '해설 생성 중 오류가 발생했습니다.', status: 500 };
  }
}
