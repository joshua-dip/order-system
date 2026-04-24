/**
 * 학생 AI 튜터 — Claude 호출 래퍼
 * 기존 admin-variant-draft-claude.ts 와 member-essay-draft-claude.ts 를 재활용.
 *
 * 지원 유형:
 *   '요약문본문어휘' — 지문에서 단어를 찾아 요약문 빈칸 완성
 *   '빈칸'          — 객관식 5지선다 빈칸 추론
 *   '주제'          — 객관식 5지선다 주제 찾기
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject } from '@/lib/llm-json';

export const STUDENT_QUESTION_TYPES = ['요약문본문어휘', '빈칸', '주제'] as const;
export type StudentQuestionType = (typeof STUDENT_QUESTION_TYPES)[number];

const STUDENT_TYPE_SET = new Set<string>(STUDENT_QUESTION_TYPES);
export function isStudentQuestionType(t: string): t is StudentQuestionType {
  return STUDENT_TYPE_SET.has(t);
}

// ─── 프롬프트 ───

const VOCAB_SYSTEM = `당신은 한국 수능 대비 영어 서술형 문제 출제 전문가입니다.
주어진 영어 지문을 바탕으로 **요약문 본문 어휘 찾기** 유형의 서술형 1문항을 만들어 주세요.
이 유형의 핵심: 요약문 틀에 빈칸 2~3곳을 두고, 학생이 지문에서 스스로 단어를 찾아 완성합니다.
아래 키만 갖는 JSON 하나만 출력하세요. 다른 설명·마크다운 금지.
키: Question(string 한국어 발문), Paragraph(string 지문 원문 그대로), Conditions(string 한국어 조건 \\n구분), SummaryFrame(string 영어 요약문 틀 빈칸은 ________), SampleAnswer(string 완성 영문), Explanation(string 한국어 해설 300자 이하), Keywords(array 정답 단어 목록)`;

const BLANK_SYSTEM = `당신은 한국 수능 영어 변형문제 출제자입니다.
주어진 영어 지문으로 **빈칸 추론** 객관식 5지선다 1문항을 만드세요.
아래 키만 갖는 JSON 하나만 출력하세요. 다른 설명·마크다운 금지.
키: Question(string "다음 빈칸에 들어갈 말로 가장 적절한 것은?" 형식 한국어), Paragraph(string 지문, 정답 구절 한 곳만 <u>_____</u>로 대체 나머지 원문 그대로), Options(string "① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ..." 형식 영어 5지선다), CorrectAnswer(string "①"~"⑤"), Explanation(string 한국어 해설 450자 이하)`;

const TOPIC_SYSTEM = `당신은 한국 수능 영어 변형문제 출제자입니다.
주어진 영어 지문으로 **주제 찾기** 객관식 5지선다 1문항을 만드세요.
아래 키만 갖는 JSON 하나만 출력하세요. 다른 설명·마크다운 금지.
키: Question(string "이 글의 주제로 가장 적절한 것은?" 형식 한국어), Paragraph(string 지문 원문 그대로), Options(string "① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ..." 형식 영어 명사구 5지선다), CorrectAnswer(string "①"~"⑤"), Explanation(string 한국어 해설 450자 이하)`;

function getSystemPrompt(type: StudentQuestionType): string {
  if (type === '요약문본문어휘') return VOCAB_SYSTEM;
  if (type === '빈칸') return BLANK_SYSTEM;
  return TOPIC_SYSTEM;
}

// ─── 생성 함수 ───

export type StudentGenerateResult =
  | { ok: true; question_data: Record<string, unknown>; type: StudentQuestionType; inputTokens?: number; outputTokens?: number }
  | { ok: false; error: string };

export async function generateStudentQuestion(params: {
  paragraph: string;
  type: StudentQuestionType;
  grade?: string;
}): Promise<StudentGenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'API 키가 설정되지 않았습니다.' };

  const { paragraph, type, grade } = params;
  const client = new Anthropic({ apiKey });
  const systemPrompt = getSystemPrompt(type);
  const userMessage = `다음 영어 지문으로 ${type} 문항을 만들어 주세요.${grade ? ` (대상: ${grade})` : ''}\n\n<지문>\n${paragraph}\n</지문>`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const parsed = extractJsonObject(rawText);
    if (!parsed) return { ok: false, error: 'AI 응답을 파싱할 수 없습니다.' };

    return {
      ok: true,
      question_data: parsed,
      type,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ─── 채점 함수 ───

export type StudentGradeResult =
  | { ok: true; isCorrect: boolean; feedback: string; inputTokens?: number; outputTokens?: number }
  | { ok: false; error: string };

export async function gradeStudentAnswer(params: {
  question_data: Record<string, unknown>;
  type: StudentQuestionType;
  studentAnswer: string;
}): Promise<StudentGradeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'API 키가 설정되지 않았습니다.' };

  const { question_data, type, studentAnswer } = params;
  const client = new Anthropic({ apiKey });

  const isObjective = type === '빈칸' || type === '주제';

  let systemPrompt: string;
  let userMessage: string;

  if (isObjective) {
    const correctAnswer = String(question_data.CorrectAnswer ?? '');
    const explanation = String(question_data.Explanation ?? '');
    systemPrompt = `당신은 영어 문제 채점 전문가입니다. 학생 답안과 정답을 비교해 정오를 판단하고, 한국어 해설을 제공합니다.
아래 키만 갖는 JSON 하나만 출력하세요: isCorrect(boolean), feedback(string 한국어 200자 이하)`;
    userMessage = `정답: ${correctAnswer}\n학생 답안: ${studentAnswer}\n\n해설 참고:\n${explanation}\n\n채점해 주세요.`;
  } else {
    // 서술형 (요약문본문어휘)
    const sampleAnswer = String(question_data.SampleAnswer ?? '');
    const keywords = Array.isArray(question_data.Keywords) ? (question_data.Keywords as string[]).join(', ') : '';
    const explanation = String(question_data.Explanation ?? '');
    systemPrompt = `당신은 영어 서술형 문제 채점 전문가입니다. 학생 답안이 모범 답안의 핵심 단어들을 포함하고 의미적으로 유사하면 정답으로 인정합니다.
아래 키만 갖는 JSON 하나만 출력하세요: isCorrect(boolean), feedback(string 한국어 250자 이하 — 정오 이유 + 모범 답안 안내)`;
    userMessage = `모범 답안: ${sampleAnswer}\n핵심 단어: ${keywords}\n학생 답안: ${studentAnswer}\n\n해설:\n${explanation}\n\n채점해 주세요.`;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const parsed = extractJsonObject(rawText) as { isCorrect?: boolean; feedback?: string } | null;
    if (!parsed) return { ok: false, error: 'AI 채점 응답을 파싱할 수 없습니다.' };

    return {
      ok: true,
      isCorrect: !!parsed.isCorrect,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
