/**
 * 회원 서술형 변형문제 초안 — Claude 호출
 *
 * 지원 유형:
 *   '요약문조건영작'  — 조건에 지정된 단어를 이용해 빈칸 완성
 *   '요약문조건영작배열' — 제공된 단어(WordBank)를 올바른 순서로 배열해 빈칸 완성
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject } from '@/lib/llm-json';

// ────────────────────────────────────────────
// 지원 유형 및 스키마
// ────────────────────────────────────────────

export const MEMBER_ESSAY_QUESTION_TYPES = ['요약문본문어휘', '요약문조건영작배열'] as const;
export type MemberEssayQuestionType = (typeof MEMBER_ESSAY_QUESTION_TYPES)[number];
const ESSAY_TYPE_SET = new Set<string>(MEMBER_ESSAY_QUESTION_TYPES);
export function isMemberEssayQuestionType(t: string): t is MemberEssayQuestionType {
  return ESSAY_TYPE_SET.has(t);
}

/**
 * 요약문 조건 영작 question_data 스키마
 * - Question     : 발문 (한국어)
 * - Paragraph    : 원문 영어 지문 (변경 없이 그대로)
 * - Conditions   : 조건 목록 (번호 포함 한국어 문자열, \n 구분)
 * - SummaryFrame : 영어 요약문 틀 — 빈칸은 ________ 표시
 * - SampleAnswer : 모범 답안 영어 완성 문장
 * - Explanation  : 한국어 해설
 * - Keywords     : 조건에 포함된 핵심 어휘 목록 (string[])
 */
export type EssayQuestionData = {
  Question: string;
  Paragraph: string;
  Conditions: string;
  SummaryFrame: string;
  SampleAnswer: string;
  Explanation: string;
  Keywords: string[];
};

/**
 * 요약문 조건 영작(배열) question_data 스키마
 * - WordBank : 빈칸을 채울 단어 목록 (무순서 제공, string[])
 * 나머지 필드는 EssayQuestionData와 동일
 */
export type ArrangementQuestionData = EssayQuestionData & {
  WordBank: string[];
};

// ────────────────────────────────────────────
// 프롬프트
// ────────────────────────────────────────────

/**
 * 요약문 본문 어휘 찾기 — 학생이 본문에서 단어를 직접 찾아 빈칸을 채우는 유형
 * Keywords = 정답 어휘 (교사 참고용; 학생에게 미리 알려주지 않음)
 */
const PASSAGE_VOCAB_SUMMARY_SYSTEM_PROMPT = `당신은 한국 수능 대비 영어 서술형 문제 출제 전문가입니다.
주어진 영어 지문을 바탕으로 **요약문 본문 어휘 찾기** 유형의 서술형 1문항을 만들어 주세요.

이 유형의 핵심:
- 요약문 틀에 빈칸 2~3곳을 두고, 학생이 **지문을 읽고 스스로 적절한 단어를 찾아** 완성합니다.
- 사용할 단어를 미리 알려주지 않습니다. (조건에 '본문에서 찾아 쓸 것'이라고만 명시)
- 정답 단어들은 반드시 **지문에 실제로 등장하는 단어** 여야 하며, 필요시 어형을 변형합니다.

아래 키만 갖는 JSON **하나**만 출력하세요. 다른 설명·마크다운 코드펜스 금지.

키 목록:
- Question      (string) 발문 — 한국어. 예: "다음 글의 내용을 요약한 문장의 빈칸에 들어갈 말을 본문에서 찾아 쓰시오. (필요시 어형 변형 가능)"
- Paragraph     (string) 지문 — 원문 영어 그대로 복사. 어떠한 마크업도 추가하지 말 것.
- Conditions    (string) 조건 목록 — 한국어, 줄바꿈(\\n)으로 구분. 예: "① 빈칸에 들어갈 단어를 본문에서 찾아 쓸 것\\n② 필요시 어형을 변형할 것\\n③ 각 빈칸에 한 단어씩 쓸 것"
- SummaryFrame  (string) 요약문 틀 — 영어 한 문장. 핵심 개념 2~3곳을 ________으로 비워둠.
- SampleAnswer  (string) 모범 답안 — SummaryFrame의 빈칸을 채운 완성 영어 문장.
- Explanation   (string) 한국어 해설 — 300자 이하. ① 지문 핵심 요약, ② 각 빈칸 정답 근거(본문 어느 부분에서 왔는지), ③ 어형 변형이 있다면 설명.
- Keywords      (array)  각 빈칸의 정답 단어 목록 (교사 참고용). 예: ["narrowing","breadth","structured"]

규칙:
1. SummaryFrame의 빈칸(________)은 2~3곳. 각 빈칸은 반드시 지문에 등장하는 단어 1개.
2. Keywords = 정답 단어들. 지문 원형 또는 어형 변형 후 형태 모두 허용.
3. Conditions에 '본문에서 찾아 쓸 것' 조건을 반드시 포함. 사용할 특정 단어를 미리 알려주지 않을 것.
4. Explanation의 ②에서 각 빈칸 정답이 본문 어디에서 나왔는지 명시.
5. 어떤 경우에도 JSON 이외의 텍스트 출력 금지.`;

// ────────────────────────────────────────────
// 배열형 프롬프트
// ────────────────────────────────────────────

const ARRANGEMENT_SUMMARY_SYSTEM_PROMPT = `당신은 한국 수능 대비 영어 서술형 문제 출제 전문가입니다.
주어진 영어 지문을 바탕으로 **요약문 조건 영작(배열)** 유형의 서술형 1문항을 만들어 주세요.

이 유형의 특징:
- 요약문 틀에 빈칸 하나(________)를 두고, 빈칸에 들어갈 단어들을 무순서로 제공합니다.
- 학생은 제공된 단어들을 올바른 순서로 배열하여 빈칸을 완성합니다.
- 조건은 배열 규칙(어형 변형 가능 여부, 단어 수 제한 등)을 안내합니다.

아래 키만 갖는 JSON **하나**만 출력하세요. 다른 설명·마크다운 코드펜스 금지.

키 목록:
- Question     (string) 발문 — 한국어. 예: "다음 글의 내용을 요약한 문장의 빈칸에 주어진 단어들을 올바른 순서로 배열하여 완성하시오."
- Paragraph    (string) 지문 — 원문 영어 그대로 복사. 어떠한 마크업도 추가하지 말 것.
- Conditions   (string) 조건 — 한국어, 줄바꿈(\\n)으로 구분. 예: "① 주어진 단어를 모두 사용할 것\\n② 필요시 어형을 변형할 것\\n③ 빈칸은 5단어로 완성할 것"
- SummaryFrame (string) 요약문 틀 — 영어 한 문장. 핵심 구(5~8단어)를 ________으로 비움. 나머지는 완성된 형태.
- WordBank     (array)  빈칸에 들어갈 단어들을 **무순서**로 나열한 string[]. 6~9개. 실제 답의 단어들이어야 하며 오답 단어는 포함하지 말 것.
- SampleAnswer (string) 모범 답안 — SummaryFrame의 빈칸에 WordBank 단어들을 올바른 순서로 채운 완성 영어 문장.
- Explanation  (string) 한국어 해설 — 300자 이하. ① 지문 핵심 요약, ② 배열 순서 근거, ③ 모범 답안 설명.
- Keywords     (array)  배열 후 문장에서 핵심적인 영단어 2~3개. string[].

규칙:
1. SummaryFrame의 빈칸(________)은 반드시 하나. 빈칸 위치는 문장 중간 또는 후반부.
2. WordBank 단어 수는 SampleAnswer의 빈칸 부분 단어 수와 정확히 일치. 오답·허수 단어 없음.
3. Conditions ①은 "주어진 단어를 모두 사용할 것"으로 고정.
4. 어형 변형이 필요한 단어가 있으면 Conditions에 명시하고 WordBank에는 원형으로 넣을 것.
5. 어떤 경우에도 JSON 이외의 텍스트 출력 금지.`;

function buildArrangementUserMessage(paragraph: string, userHint?: string): string {
  let msg = `다음 영어 지문으로 요약문 조건 영작(배열) 문항을 만들어 주세요.\n\n<지문>\n${paragraph}\n</지문>`;
  if (userHint) msg += `\n\n<추가 힌트>\n${userHint}\n</추가 힌트>`;
  return msg;
}

function buildPassageVocabUserMessage(paragraph: string, userHint?: string): string {
  let msg = `다음 영어 지문으로 요약문 본문 어휘 찾기 문항을 만들어 주세요.\n\n<지문>\n${paragraph}\n</지문>`;
  if (userHint) msg += `\n\n<추가 힌트>\n${userHint}\n</추가 힌트>`;
  return msg;
}

// ────────────────────────────────────────────
// 생성 함수
// ────────────────────────────────────────────

export type EssayDraftParams = {
  paragraph: string;
  type: MemberEssayQuestionType;
  userHint?: string;
  anthropicApiKey: string;
};

export type EssayDraftResult =
  | { ok: true; question_data: EssayQuestionData | ArrangementQuestionData }
  | { ok: false; error: string };

function normalizeBaseFields(parsed: Record<string, unknown>, paragraph: string): EssayQuestionData {
  return {
    Question:
      typeof parsed.Question === 'string' && parsed.Question.trim()
        ? parsed.Question.trim()
        : '다음 글의 내용을 조건에 맞게 요약하는 영어 문장을 완성하시오.',
    Paragraph:
      typeof parsed.Paragraph === 'string' && parsed.Paragraph.trim()
        ? parsed.Paragraph.trim()
        : paragraph.trim(),
    Conditions: typeof parsed.Conditions === 'string' ? parsed.Conditions.trim() : '',
    SummaryFrame: typeof parsed.SummaryFrame === 'string' ? parsed.SummaryFrame.trim() : '',
    SampleAnswer: typeof parsed.SampleAnswer === 'string' ? parsed.SampleAnswer.trim() : '',
    Explanation: typeof parsed.Explanation === 'string' ? parsed.Explanation.trim() : '',
    Keywords: Array.isArray(parsed.Keywords)
      ? (parsed.Keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : [],
  };
}

export async function generateEssayDraftWithClaude(params: EssayDraftParams): Promise<EssayDraftResult> {
  const { paragraph, type, userHint, anthropicApiKey } = params;
  const isArrangement = type === '요약문조건영작배열';

  const client = new Anthropic({ apiKey: anthropicApiKey });

  let rawText: string;
  try {
    const systemPrompt = isArrangement
      ? ARRANGEMENT_SUMMARY_SYSTEM_PROMPT
      : PASSAGE_VOCAB_SUMMARY_SYSTEM_PROMPT;

    const userMessage = isArrangement
      ? buildArrangementUserMessage(paragraph, userHint)
      : buildPassageVocabUserMessage(paragraph, userHint);

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const block = response.content[0];
    if (block.type !== 'text') {
      return { ok: false, error: 'Claude 응답 형식 오류' };
    }
    rawText = block.text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Claude API 오류: ${msg}` };
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return { ok: false, error: 'JSON 파싱 실패 — Claude 응답을 읽지 못했습니다.' };
  }

  const base = normalizeBaseFields(parsed, paragraph);

  if (!base.Conditions || !base.SummaryFrame || !base.SampleAnswer) {
    return { ok: false, error: '생성된 문항에 필수 항목(조건/요약 틀/모범 답안)이 없습니다.' };
  }

  if (isArrangement) {
    const wordBank = Array.isArray(parsed.WordBank)
      ? (parsed.WordBank as unknown[]).filter((w): w is string => typeof w === 'string')
      : [];
    if (wordBank.length === 0) {
      return { ok: false, error: '배열형 문항에 WordBank(단어 목록)가 없습니다.' };
    }
    const qd: ArrangementQuestionData = { ...base, WordBank: wordBank };
    return { ok: true, question_data: qd };
  }

  return { ok: true, question_data: base };
}
