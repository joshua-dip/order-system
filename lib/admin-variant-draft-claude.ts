/**
 * 관리자 변형문 초안 — Claude 호출 (generate-draft / 일괄 재생성 공용)
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject } from '@/lib/llm-json';
import { VARIANT_DRAFT_BLANK_AND_SUMMARY_RULES } from '@/lib/variant-draft-blank-summary-rules';
import { GRAMMAR_VARIANT_OPTIONS_FIXED, VARIANT_DRAFT_GRAMMAR_RULES } from '@/lib/variant-draft-grammar-rules';
import { HARD_INSERTION_PROMPT } from '@/lib/hard-insertion-generator';
import { IRRELEVANT_SENTENCE_PROMPT } from '@/lib/irrelevant-sentence-generator';

export function buildVariantDraftSystemPrompt(nextNum: number): string {
  return `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 지문과 문제 유형에 맞는 객관식 1문항을 새로 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 다른 설명·마크다운 금지.

키: 순서(number), Source(string, 보통 빈 문자열), NumQuestion(number), Category(string), Question(string, 발문), Paragraph(string), Options(string), OptionType(string), CorrectAnswer(string, 1~5 또는 ①~⑤), Explanation(string, 한국어 해설)

공통 규칙:
1) Paragraph: 지문을 입력과 동일하게 유지. 주제·제목·주장·일치·불일치에서는 <u> 없이 원문 그대로 복사. 함의(함축의미)·어법은 지정 형식으로 <u>...</u> 사용. 빈칸 유형은 정답 구절 **한 곳만** 빼고 그 자리를 \`<u>_____</u>\` 밑줄로 두고 나머지는 원문과 동일. 어법은 5개 밑줄을 "③ <u>표현</u>" 형식(동그라미는 <u> 밖, 번호와 <u> 사이 공백 1칸)으로 표시. **지문 앞→뒤 읽는 순서가 곧 ①→②→③→④→⑤**(첫 밑줄=①, 건너뛰기 금지). 한 문장당 동그라미 1개. **어법의 Options**는 아래 어법 유형 규칙(번호만 \`①###②###③###④###⑤\`).
2) Options: **어법·삽입·삽입-고난도·무관한문장 제외** 모든 유형의 5개 보기 텍스트는 **반드시 영어로만** 작성한다. **한국어 선택지 절대 금지**(함의·요약·주제·제목·주장·일치·불일치·빈칸·순서 — 모두 영어). **5개 보기는 하나의 문자열**로, 보기 사이는 **오직 \`###\` 세 개**로만 구분. 예: \`① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ...\`. **객체(JSON dict) 형태로 Options를 출력하면 안 된다** — 반드시 위 문자열 형식. **어법**은 예외 — \`①###②###③###④###⑤\`만(번호만, Paragraph의 \`<u>\` 안에 보기 내용). **삽입·삽입-고난도·무관한문장**은 \`① ### ② ### ③ ### ④ ### ⑤\` 형태(번호만).
3) OptionType: 항상 "English".
4) NumQuestion과 순서는 ${nextNum}.
5) Explanation(해설): **짧게**. 한국어 **450자 이하**(대략 4~7문장). 다른 보기·번호를 두고 **망설이다 결론을 바꾸는 서술**(실제로 맞다/틀리다가 엇갈리는 문장) 금지. CorrectAnswer와 **하나의 결론**만 명확히.

유형별 규칙:
- 함의(함축의미): Paragraph는 입력 지문 전체를 그대로 복사하되, 함축적 의미가 담긴 구절(보통 한 문장 또는 의미 단위)을 \`<u>...</u>\`로 감싼다. Question은 "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" 형식. 정답은 밑줄 부분의 함축적 의미와 일치하는 보기 하나, 오답은 그럴듯하지만 지문과 맞지 않는 내용. **5개 보기 모두 반드시 영어로**(한국어 금지). 밑줄 부분이 소문자로 시작하면 모든 선택지도 소문자로 시작, 대문자로 시작하면 선택지도 대문자로 시작. 고등학교 수준 어휘·표현 사용.
  **Explanation(매우 중요)**: 단순한 정형구(예: "지문에 직접 쓰이지 않았으나 논리적으로 따라올 수 있는 함의에 해당합니다." 같은 문구) 절대 금지. 반드시 (1) 밑줄 친 구절의 **표면적 의미**, (2) 그 구절이 지문 맥락에서 **함의하는 바**(왜 그런 의미인지 앞뒤 맥락 근거), (3) 정답 보기가 그 함의와 어떻게 일치하는지를 한국어로 구체 서술 — 전체 450자 이하.
- 주제: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 주제로 가장 적절한 것은?", "이 글의 요지로 가장 적절한 것은?". 보기(Options) 규칙: 정답 1개+오답 4개, 각 8~12단어. 명사구(noun phrase) 형태로 작성(문장 X). reasons, roles, advantages, benefits, problems, ways, functions, effects, causes, difficulties, factors, policies, importance, impact, necessity, need, process 등 활용 가능. 지문 어휘 사용 가능하되 조동사 등 보조어는 피할 것. 정답은 소문자로 시작, 관사로 시작 금지. 오답은 지문과 어긋나거나 반대되는 내용. 고유명사·인명·책제목·우화·비유 이름을 주제로 삼지 말 것. MAIN IDEA·원리·개념에 집중하고, 예시·도구·비유 자체의 이름/라벨은 피할 것.
- 제목: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 제목으로 가장 적절한 것은?", "위 글에 가장 잘 어울리는 제목은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 뉴스 헤드라인 스타일로, 지문의 주제·핵심을 함축. 각 선택지는 대문자로 시작. 고유명사·인명·책제목·우화·비유 이름을 제목으로 쓰지 말 것. MAIN MESSAGE·CONCEPT에 집중, 예시나 도구 이름이 아닌 핵심 메시지로. 오답은 그럴듯하지만 틀린 제목(범위 어긋남·부적절). CEFR B1~C1 수준.
- 주장: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?", "위 글의 필자의 주장과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 필자가 전달하려는 핵심 메시지(사소한 세부 X). must, should, have to 등 조동사와 important, essential, significant, critical, vital, crucial, necessary, desirable, appropriate 등 형용사로 완전한 문장. you/he/she로 시작하지 말 것; dummy subject "it" 사용 가능. 구체적 예시·우화·스토리·비유를 이름으로 언급하지 말 것. 원리·교훈에 집중, 예시 자체가 아닌. 정답은 지문의 핵심 주장과 일치, 오답은 반대 주장 또는 지문에 없는 내용. CEFR B1~C1.
- 일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하는 것은?", "위 글의 내용과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 8~15단어. 장소·인명·작품명 등은 원문 그대로. 직역 금지, 의역(paraphrasing) 필수. 대명사(you, your, he, his, she, her, they, their, it, its) 사용 금지. 한 문장에서 유도하거나 여러 문장을 합쳐 한 보기로 가능. 명령형 문장 피할 것. 정답은 지문과 의미적으로 동일한 한 보기, 오답은 지문과 다른 내용 또는 일부만 맞는 문장. CEFR B1~C1.
- 불일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하지 않는 것은?", "위 글의 내용과 일치하지 않는 것은?". 보기 규칙: 정답 1개(지문과 다른 내용)+오답 4개(지문과 일치하는 내용). 각 8~15단어. 장소·인명·작품명은 원문 그대로. 의역 필수, 대명사 금지, 명령형 피할 것(일치 유형과 동일). 정답은 지문에 없는 내용이거나 지문과 반대/틀린 한 보기, 오답은 지문과 일치하는 문장. CEFR B1~C1.
${VARIANT_DRAFT_GRAMMAR_RULES}
- 순서(글의순서): Question은 "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오."로 작성. Paragraph는 (1) 맨 위에 주어진 문장(첫 문장) 한 줄, (2) 빈 줄 또는 구분 후 (A), (B), (C) 세 블록을 나열. 각 블록은 여러 문장으로 구성되며, (A)-(B)-(C)의 올바른 순서를 뒤섞어 제시(예: (B)-(A)-(C), (C)-(B)-(A) 등). 블록 구분은 줄바꿈 또는 ### 사용. Options는 반드시 5개를 **한 문자열**로, 보기 사이는 \`###\`만: \`① (A)-(C)-(B) ### ② (B)-(A)-(C) ### ③ (B)-(C)-(A) ### ④ (C)-(A)-(B) ### ⑤ (C)-(B)-(A)\` 형식. CorrectAnswer는 올바른 순서에 해당하는 ①~⑤ 중 하나. Explanation은 "① 가 정답입니다."로 시작, 흐름 설명은 압축하고 마지막에 "논리 흐름 요약:" 한 문장 — **전체 450자 이하**. Paragraph에 <u> 태그 사용하지 말 것.
- 삽입(문장삽입): Question은 "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오."로 작성. **Paragraph 형식(매우 중요)**: 반드시 (1) 첫 줄에 **주어진 문장 한 줄**, (2) 그 다음 \`\\n\\n\`(빈 줄 한 줄로 명확히 분리) 또는 \`### \` 구분, (3) 본문 — 으로 구성. 즉 주어진 문장과 본문 사이에 **반드시 빈 줄 1개 이상**이 들어가 있어야 한다(붙여 쓰면 안 됨). 본문에는 삽입 가능한 위치 5곳을 ①②③④⑤로 표시해 문장 사이에 배치(예: \`... ① 다음 문장 ② ...\`). CorrectAnswer는 주어진 문장이 들어가야 할 위치 번호 ①~⑤ 중 하나. Options는 \`① ### ② ### ③ ### ④ ### ⑤\` 형식(위치 번호만).
  **Explanation(매우 중요)**: 단순 정형구(예: "삽입 위치의 앞뒤 문맥과 접속 관계가 가장 자연스러운 곳입니다." 같은 문구) 절대 금지. 반드시 (1) "③ 가 정답입니다."처럼 **CorrectAnswer 번호로 시작**, (2) 정답 위치 **앞 문장과 주어진 문장의 연결**(지시어·접속어·인과·예시 등 구체 근거), (3) 주어진 문장과 **뒤 문장의 자연스러운 연결**, (4) 마지막에 "논리 흐름 요약:" 한 문장 — 전체 450자 이하. 지문의 실제 단어·표현을 인용해 설명. Paragraph에 \`<u>\` 태그 사용 금지.
- 무관한문장: Question은 "다음 글에서 전체 흐름과 관계없는 문장은?"으로 작성. Paragraph는 원문 문장들 사이에 **주제와 완전히 무관한 문장** 1개를 끼워넣되, 첫 문장은 번호 없이 도입부로 두고 두 번째 문장부터 ①②③④⑤ 번호를 부여(문장 수 부족 시에만 첫 문장에도 번호). 무관한 문장은 글의 톤·어휘 수준은 유지하되 주제가 완전히 다른 독립적 사실 문장이어야 하며 지시어(this, such)·접속사(however, therefore)로 앞뒤 문장을 참조하면 안 됨. CorrectAnswer는 무관한 문장의 번호 ①~⑤. Options는 \`① ### ② ### ③ ### ④ ### ⑤\`. Explanation은 "②가 정답입니다."로 시작, 글 전체 흐름 요약 후 해당 문장이 왜 무관한지 설명 — **전체 450자 이하**.
${VARIANT_DRAFT_BLANK_AND_SUMMARY_RULES}`;
}

export type VariantDraftClaudeParams = {
  paragraph: string;
  type: string;
  /** 프롬프트에 넣을 문항 번호(기존 문항 재생성 시 보존 번호) */
  nextNum: number;
  userHint?: string;
  typePrompt?: string;
  difficulty?: string;
  /** 회원이 본인 키로 호출할 때 전달. 없으면 서버 ANTHROPIC_API_KEY 사용 */
  anthropicApiKey?: string;
};

export type VariantDraftClaudeResult =
  | { ok: true; question_data: Record<string, unknown> }
  | { ok: false; error: string };

/** Claude(또는 Claude Code)가 출력한 JSON 객체 → 폼용 question_data (API 경로와 동일 규칙) */
export function normalizeClaudeDraftJsonToQuestionData(
  parsed: Record<string, unknown>,
  params: { paragraph: string; type: string; nextNum: number }
): Record<string, unknown> {
  const { paragraph, type, nextNum } = params;
  const parsedParagraph =
    typeof parsed.Paragraph === 'string' && parsed.Paragraph.trim()
      ? parsed.Paragraph.trim()
      : paragraph;
  let questionText = typeof parsed.Question === 'string' ? parsed.Question : '';
  const typeT = type.trim();
  if (typeT === '함의' || typeT.includes('함의')) {
    const uMatch = parsedParagraph.match(/<u>([\s\S]*?)<\/u>/i);
    const underlinedText = uMatch ? uMatch[1].trim() : '';
    if (underlinedText) {
      questionText = `밑줄 친 "${underlinedText}" 표현이 다음 글에서 의미하는 바로 가장 적절한 것은?`;
    }
  }
  const question_data: Record<string, unknown> = {
    순서: typeof parsed.순서 === 'number' ? parsed.순서 : nextNum,
    Source: typeof parsed.Source === 'string' ? parsed.Source : '',
    NumQuestion: typeof parsed.NumQuestion === 'number' ? parsed.NumQuestion : nextNum,
    Category: typeof parsed.Category === 'string' ? parsed.Category : type,
    Question: questionText,
    Paragraph: parsedParagraph,
    Options: typeof parsed.Options === 'string' ? parsed.Options : '',
    OptionType: 'English',
    CorrectAnswer: typeof parsed.CorrectAnswer === 'string' ? parsed.CorrectAnswer : '',
    Explanation: typeof parsed.Explanation === 'string' ? parsed.Explanation : '',
  };

  if (typeT === '어법') {
    question_data.Options = GRAMMAR_VARIANT_OPTIONS_FIXED;
  }

  return question_data;
}

export function buildVariantDraftUserMessage(params: VariantDraftClaudeParams): string {
  const { paragraph, type, userHint = '', typePrompt = '', difficulty = '중' } = params;
  const typeT = type.trim();
  const diff = (typeof difficulty === 'string' ? difficulty : '중').trim() || '중';
  /** 유형 `삽입-고난도` 또는 (구버전/관리자) `삽입` + 난이도 상 */
  const isHardInsertion = typeT === '삽입-고난도' || (diff === '상' && typeT === '삽입');
  const extra =
    (process.env.ANTHROPIC_VARIANT_DRAFT_EXTRA && process.env.ANTHROPIC_VARIANT_DRAFT_EXTRA.trim()) ||
    '';

  const hardBlock = isHardInsertion
    ? `【난이도 상 · 삽입 문장 생성 전용 규칙】\n${HARD_INSERTION_PROMPT}\n\n`
    : '';

  const isIrrelevant = type === '무관한문장';
  const irrelevantBlock = isIrrelevant
    ? `【무관한문장 유형 전용 규칙】\n${IRRELEVANT_SENTENCE_PROMPT}\n\n`
    : '';

  return `문제 유형(type): ${type}${isHardInsertion ? ' (고난도 삽입 규칙 — 새 문장 생성)' : ''}${isIrrelevant ? ' (무관한 문장 생성)' : ''}
${extra ? `운영자 공통 지시(.env): ${extra}\n` : ''}${hardBlock}${irrelevantBlock}${typePrompt ? `【이 유형 전용 출제 지침】\n${typePrompt}\n\n` : ''}${userHint ? `이번 문항만의 추가 지시: ${userHint}\n` : ''}
[지문 Paragraph]
${paragraph}`;
}

/**
 * passage 원문 paragraph + 유형으로 Claude JSON question_data 생성 (DB 저장 없음).
 */
export async function generateVariantDraftQuestionDataWithClaude(
  params: VariantDraftClaudeParams
): Promise<VariantDraftClaudeResult> {
  const { paragraph, type, nextNum, userHint = '', typePrompt = '', difficulty = '중', anthropicApiKey } = params;
  const apiKey = (anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      error: anthropicApiKey
        ? '유효한 Anthropic API 키가 필요합니다.'
        : 'AI 초안 생성에는 ANTHROPIC_API_KEY 설정이 필요합니다.',
    };
  }
  const model =
    (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
    'claude-sonnet-4-6';

  const client = new Anthropic({ apiKey });
  const sys = buildVariantDraftSystemPrompt(nextNum);
  const userMsg = buildVariantDraftUserMessage({ paragraph, type, nextNum, userHint, typePrompt, difficulty });

  const fixJsonUserMsg =
    '위 출력은 JSON.parse로 파싱할 수 없었습니다. 반드시 키만 갖는 유효한 JSON 한 개만 출력하세요. 마크다운·코드펜스·설명 문장 금지. 문자열 안의 따옴표는 반드시 \\" 로 이스케이프하세요.';

  let message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: sys,
    messages: [{ role: 'user', content: userMsg }],
  });
  let responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';
  let parsed = extractJsonObject(responseText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: sys,
      messages: [
        { role: 'user', content: userMsg },
        { role: 'assistant', content: responseText || '(빈 응답)' },
        { role: 'user', content: fixJsonUserMsg },
      ],
    });
    responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';
    parsed = extractJsonObject(responseText);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        'AI 응답에서 JSON을 파싱하지 못했습니다. 다시 시도하거나 유형별 AI 프롬프트를 조정해 보세요.',
    };
  }

  const question_data = normalizeClaudeDraftJsonToQuestionData(parsed, { paragraph, type, nextNum });
  return { ok: true, question_data };
}

/** 기존 question_data에서 Claude용 nextNum(숫자) 추출 */
export function coerceNumQuestionForPrompt(oldQd: Record<string, unknown>): number {
  const n = oldQd.NumQuestion ?? oldQd.순서;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  const s = String(n ?? '').replace(/\D/g, '');
  const p = parseInt(s, 10);
  return Number.isFinite(p) && p > 0 ? p : 1;
}
