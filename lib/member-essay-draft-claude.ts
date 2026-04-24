/**
 * 회원 서술형 변형문제 초안 — Claude 호출
 *
 * 지원 유형:
 *   '요약문본문어휘'    — 조건에 지정된 단어를 이용해 빈칸 완성
 *   '요약문조건영작배열' — 제공된 단어(WordBank)를 올바른 순서로 배열해 빈칸 완성
 *   '빈칸재배열형'      — 주제문 핵심 구를 보기 단어 재배열로 완성
 *   '요약문조건영작형'   — 한 문장 요약 빈칸을 문법 조건 3개에 맞게 완성
 *   '이중요지영작형'    — 지문 기반 두 가지 관점을 영어로 통합 서술
 */
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject } from '@/lib/llm-json';

// ────────────────────────────────────────────
// 지원 유형 및 스키마
// ────────────────────────────────────────────

export const MEMBER_ESSAY_QUESTION_TYPES = [
  '요약문본문어휘',
  '요약문조건영작배열',
  '빈칸재배열형',
  '요약문조건영작형',
  '이중요지영작형',
] as const;
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
  /** 서술형대비 중심 문장 (지문 분석기에서 선택) — 있으면 userHint 앞에 합성 */
  focusSentences?: string[];
  anthropicApiKey: string;
};

/**
 * 빈칸재배열형 question_data
 * - Phrase           : 주제문에서 발췌한 핵심 구 (정답)
 * - Chunks           : 셔플된 보기 단어/덩어리 (string[])
 * - PassageWithBlank : 빈칸이 삽입된 지문 전체
 * - WordBox          : 보기 표시용 문자열 ("chunk1 / chunk2 / …", 셔플 순서)
 * - Explanation      : 한국어 해설
 */
export type BlankRearrangementQuestionData = {
  Phrase: string;
  Chunks: string[];
  PassageWithBlank: string;
  WordBox: string;
  Explanation: string;
};

/**
 * 요약문조건영작형 question_data
 * - SummaryWithBlank : 빈칸(_______________) 포함 요약 문장
 * - Conditions       : 조건 3개 (string[3])
 * - Answer           : 모범 답안 (빈칸 채운 구)
 * - AnswerAlt        : 허용 답안
 * - ExplanationKo    : 한국어 해설
 * - TopicKo          : 주제 요약 (짧은 한국어)
 * - Points           : 배점
 */
export type SummaryConditionalQuestionData = {
  SummaryWithBlank: string;
  Conditions: string[];
  Answer: string;
  AnswerAlt: string;
  ExplanationKo: string;
  TopicKo: string;
  Points: number;
};

/**
 * 이중요지영작형 question_data
 * - InstructionIntroEn : 도입 한 문장 영어
 * - Task1En            : 하위 과제 1 (소문자 간접절)
 * - Task2En            : 하위 과제 2
 * - WordMin / WordMax  : 단어 수 범위
 * - Points             : 배점
 * - ModelAnswerEn      : 모범 답안
 * - ModelAnswerAltEn   : 허용 답안
 * - ExplanationKo      : 한국어 해설
 * - TopicKo            : 주제 요약
 */
export type DualPointQuestionData = {
  InstructionIntroEn: string;
  Task1En: string;
  Task2En: string;
  WordMin: number;
  WordMax: number;
  Points: number;
  ModelAnswerEn: string;
  ModelAnswerAltEn: string;
  ExplanationKo: string;
  TopicKo: string;
};

export type EssayDraftResult =
  | {
      ok: true;
      question_data:
        | EssayQuestionData
        | ArrangementQuestionData
        | BlankRearrangementQuestionData
        | SummaryConditionalQuestionData
        | DualPointQuestionData;
    }
  | { ok: false; error: string };

// ────────────────────────────────────────────
// 빈칸재배열형 프롬프트 & 생성
// ────────────────────────────────────────────

const BLANK_REARRANGEMENT_SYSTEM = `You are a Korean CSAT 서술형 item writer creating blank-rearrangement (빈칸재배열) problems.

Find the TOPIC SENTENCE (main claim/thesis — usually first, last, or after contrast words "however/but/yet") in the passage.
Select a key phrase (5–9 consecutive words) from THAT topic sentence. Do NOT pick from the 1st or 2nd sentence.
Split into 4–6 chunks for students to rearrange (no form change, all words used once).

Output ONLY a valid JSON object (no markdown, no prose):
{
  "phrase": "exact phrase copied verbatim from topic sentence",
  "chunks": ["chunk1", "chunk2", "chunk3", "chunk4"],
  "passage_with_blank": "full original passage with the phrase replaced by ________",
  "word_box": "chunk4 / chunk1 / chunk3 / chunk2",
  "explanation_ko": "3 Korean sentences: ①글 주제와의 연결 ②정답 구의 한국어 해석 ③어순의 문법적 근거. 총 100자 이내."
}

Rules:
1. phrase = 5–9 consecutive words copied EXACTLY from the passage (no modification).
2. chunks joined with spaces must equal phrase exactly. Use 4–6 chunks.
3. phrase must NOT end with: do/does/did/is/are/was/were/the/a/an/to/of/and/or/but.
4. word_box = chunks in SHUFFLED (non-answer) order joined with " / ". Do NOT preserve answer order.
5. passage_with_blank: replace only the phrase in the original passage with ________ (8 underscores).
6. Do NOT output any text outside the JSON object.`;

async function generateBlankRearrangement(
  client: Anthropic,
  paragraph: string,
  userHint?: string,
): Promise<EssayDraftResult> {
  let userMsg = `다음 영어 지문으로 빈칸재배열형(주제문 기반) 문항을 만들어 주세요.\n\n<지문>\n${paragraph}\n</지문>`;
  if (userHint) userMsg += `\n\n<추가 힌트>\n${userHint}\n</추가 힌트>`;

  let rawText: string;
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1600,
      system: BLANK_REARRANGEMENT_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });
    const block = res.content[0];
    if (block.type !== 'text') return { ok: false, error: 'Claude 응답 형식 오류' };
    rawText = block.text;
  } catch (e) {
    return { ok: false, error: `Claude API 오류: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) return { ok: false, error: 'JSON 파싱 실패 — 빈칸재배열형 응답을 읽지 못했습니다.' };

  const phrase = typeof parsed.phrase === 'string' ? parsed.phrase.trim() : '';
  const chunks = Array.isArray(parsed.chunks)
    ? (parsed.chunks as unknown[]).filter((c): c is string => typeof c === 'string').map((c) => c.trim())
    : [];
  const passageWithBlank =
    typeof parsed.passage_with_blank === 'string' ? parsed.passage_with_blank.trim() : '';
  const wordBox = typeof parsed.word_box === 'string' ? parsed.word_box.trim() : chunks.join(' / ');
  const explanation = typeof parsed.explanation_ko === 'string' ? parsed.explanation_ko.trim() : '';

  if (!phrase || chunks.length < 3 || !passageWithBlank) {
    return { ok: false, error: '빈칸재배열형 문항에 필수 항목(구/청크/지문)이 없습니다.' };
  }

  const qd: BlankRearrangementQuestionData = {
    Phrase: phrase,
    Chunks: chunks,
    PassageWithBlank: passageWithBlank,
    WordBox: wordBox,
    Explanation: explanation,
  };
  return { ok: true, question_data: qd };
}

// ────────────────────────────────────────────
// 요약문조건영작형 프롬프트 & 생성
// ────────────────────────────────────────────

/**
 * 이 시스템 프롬프트는 파이썬 요약문조건영작형에서 이식.
 * STEP A~E 체크리스트를 Claude가 내부적으로 실행하되 출력하지 않음.
 */
const SUMMARY_CONDITIONAL_SYSTEM = `You are a Korean CSAT 서술형 item writer. Create ONE summary-with-blank item per request.

CRITICAL — OUTPUT FORMAT (violations cause pipeline failure):
• Your ENTIRE reply must be ONE JSON object only.
• The first non-whitespace character MUST be "{" and the last MUST be "}".
• Do NOT write introductions ("I'll", "Here is"), markdown (**STEP**), code fences, or any English/Korean prose outside JSON.
• Do NOT print checklists, "STEP A/B", or "REL_PRESENT" style notes — think silently only.

INTERNAL CHECKLIST (silent only — never print this section):

━━ STEP A: Scan the summary sentence (blank → DUMMY) for existing structures ━━
Search word-by-word through the ENTIRE sentence including the end:

  OF_PRESENT      : any word "of" appears anywhere → mark it
  GERUND_PRESENT  : preposition immediately followed by -ing word (e.g. "by making", "of becoming", "for ensuring")
  PARTICIPLE_PRESENT : -ing word that modifies a noun OR forms a participial phrase
                       ← includes END-OF-SENTENCE phrases like ", ensuring...", ", urging...", ", allowing..."
                       ← includes mid-sentence: "a growing concern", "the increasing pressure"
  TO_INF_PRESENT  : "to" + verb base (e.g. "to take", "to imagine", "to protect")
  REL_PRESENT     : who / which / that immediately after a NOUN (not after a verb like "reveals that")

  Mark each flag that applies. A flag once marked means that structure is BANNED from conditions.

━━ STEP B: Write the summary_with_blank sentence ━━
Write ONE sentence summarizing the passage with _______________ as the blank.
STRICT RULES for the summary sentence:
  - Use a SIMPLE main clause structure: Subject + Verb + Object/Complement + blank
  - DO NOT end the sentence with a participial phrase (", ensuring...", ", urging...", ", allowing...", ", making...", etc.)
  - DO NOT include relative clauses (who/which/that) in the summary
  - DO NOT use to-infinitive in the summary sentence outside the blank
  - Keep it clean so that conditions can be placed in the blank phrase without overlap
  - The blank is filled by a 4–12 word noun phrase

After writing the summary, re-run STEP A on it to update all flags.

━━ STEP C: Design the answer phrase with TWO DISTINCT structures ━━
The answer must contain exactly two grammar structures for conditions[0] and conditions[1].
They must target DIFFERENT WORDS in the answer (not two labels for the same word/phrase).

DIVERSITY (critical):
  • Do NOT default to [과거분사 + to부정사] or [현재분사 + 관계대명사] every time.
  • Choose any TWO structures from the POOL below that (1) are NOT banned by STEP A flags, (2) fit the blank naturally, (3) attach to different words in the answer phrase.

POOL:
  A. 현재분사가 명사를 수식 (-ing 형용사용)
  B. 과거분사가 명사를 수식
  C. to부정사 (purpose/result/complement)
  D. 동명사 (-ing as noun after prep) — NOT if GERUND_PRESENT
  E. 동격의 of ("X of Y" where X≡Y) — NOT if OF_PRESENT
  F. 관계대명사 절 (who/which/that after noun) — NOT if REL_PRESENT
  G. 관계부사 절 (where/when after noun)
  H. 전치사구로 명사구 수식

FORBIDDEN COMBINATIONS: 동격의 of + 동명사 (co-occur in "X of Y-ing")

━━ STEP D: Write conditions ━━
conditions[0]: Korean term + rule for structure 1
conditions[1]: Korean term + rule for structure 2 (DIFFERENT word than conditions[0])
conditions[2]: Meaning condition in Korean

CONDITION WORDING RULE:
  - Do NOT start conditions with "blank에는" or "빈칸에는"
  - End every condition with "~할 것"
  - Vary wording; do not copy the same stock phrases every time.

━━ STEP E: Write answer and answer_alt satisfying all 3 conditions ━━

Your reply = raw JSON only. No other characters before or after the object.`;

const SUMMARY_CONDITIONAL_USER_TEMPLATE = `Passage:
{passage}

Return ONE JSON object (keys: summary_with_blank, conditions, answer, answer_alt, explanation_ko, topic_ko, points).
conditions: array of 3 strings — two grammar rules + one meaning line.
Start your reply with {{ immediately — no preamble.
Example shape:
{{"summary_with_blank":"Sentence with _______________ as blank.","conditions":["…","…","…"],"answer":"…","answer_alt":"…","explanation_ko":"…","topic_ko":"…","points":5}}`;

async function generateSummaryConditional(
  client: Anthropic,
  paragraph: string,
  userHint?: string,
): Promise<EssayDraftResult> {
  let userMsg = SUMMARY_CONDITIONAL_USER_TEMPLATE.replace('{passage}', paragraph);
  if (userHint) userMsg += `\n\n<추가 힌트>\n${userHint}\n</추가 힌트>`;

  let rawText: string;
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1200,
      system: SUMMARY_CONDITIONAL_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });
    const block = res.content[0];
    if (block.type !== 'text') return { ok: false, error: 'Claude 응답 형식 오류' };
    rawText = block.text;
  } catch (e) {
    return { ok: false, error: `Claude API 오류: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) return { ok: false, error: 'JSON 파싱 실패 — 요약문조건영작형 응답을 읽지 못했습니다.' };

  const summaryWithBlank =
    typeof parsed.summary_with_blank === 'string' ? parsed.summary_with_blank.trim() : '';
  const conditions = Array.isArray(parsed.conditions)
    ? (parsed.conditions as unknown[]).filter((c): c is string => typeof c === 'string').map((c) => c.trim())
    : [];
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  const answerAlt = typeof parsed.answer_alt === 'string' ? parsed.answer_alt.trim() : '';
  const explanationKo = typeof parsed.explanation_ko === 'string' ? parsed.explanation_ko.trim() : '';
  const topicKo = typeof parsed.topic_ko === 'string' ? parsed.topic_ko.trim() : '';
  const points = typeof parsed.points === 'number' ? parsed.points : 5;

  if (!summaryWithBlank || conditions.length < 2 || !answer) {
    return { ok: false, error: '요약문조건영작형 문항에 필수 항목(요약/조건/답안)이 없습니다.' };
  }

  const qd: SummaryConditionalQuestionData = {
    SummaryWithBlank: summaryWithBlank,
    Conditions: conditions,
    Answer: answer,
    AnswerAlt: answerAlt,
    ExplanationKo: explanationKo,
    TopicKo: topicKo,
    Points: points,
  };
  return { ok: true, question_data: qd };
}

// ────────────────────────────────────────────
// 이중요지영작형 프롬프트 & 생성
// ────────────────────────────────────────────

const DUAL_POINT_SYSTEM = `Korean CSAT 서술형 item writer. Create integrated English writing tasks from the given passage only.
- task1_en/task2_en: lowercase indirect clauses (e.g. "how X determines Y"), no "?", passage-grounded.
- model_answer_en: primary full-mark answer, within word_min–word_max, addresses BOTH tasks in connected prose.
- model_answer_alt_en: alternative acceptable answer — different wording/structure, same content coverage, also within word_min–word_max.
- Output ONLY a valid JSON object (no markdown, no array wrapper).`;

const DUAL_POINT_USER_TEMPLATE = `Passage:
{passage}

Generate ONE variant. Return a JSON object:
{{"instruction_intro_en":"This passage explains …","task1_en":"…","task2_en":"…","word_min":40,"word_max":50,"points":8,"model_answer_en":"primary full-mark answer","model_answer_alt_en":"alternative acceptable answer (different phrasing, same coverage)","explanation_ko":"1–2 sentences in Korean for teachers.","topic_ko":"short Korean phrase"}}

Rules: word_min/max default 40/50 (use 35/45 for short passages <150 words); both model answers must be within [word_min,word_max] words.`;

async function generateDualPoint(
  client: Anthropic,
  paragraph: string,
  userHint?: string,
): Promise<EssayDraftResult> {
  let userMsg = DUAL_POINT_USER_TEMPLATE.replace('{passage}', paragraph);
  if (userHint) userMsg += `\n\n<추가 힌트>\n${userHint}\n</추가 힌트>`;

  let rawText: string;
  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1200,
      system: DUAL_POINT_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });
    const block = res.content[0];
    if (block.type !== 'text') return { ok: false, error: 'Claude 응답 형식 오류' };
    rawText = block.text;
  } catch (e) {
    return { ok: false, error: `Claude API 오류: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) return { ok: false, error: 'JSON 파싱 실패 — 이중요지영작형 응답을 읽지 못했습니다.' };

  const instructionIntroEn =
    typeof parsed.instruction_intro_en === 'string' ? parsed.instruction_intro_en.trim() : '';
  const task1En = typeof parsed.task1_en === 'string' ? parsed.task1_en.trim() : '';
  const task2En = typeof parsed.task2_en === 'string' ? parsed.task2_en.trim() : '';
  const modelAnswerEn = typeof parsed.model_answer_en === 'string' ? parsed.model_answer_en.trim() : '';
  const modelAnswerAltEn =
    typeof parsed.model_answer_alt_en === 'string' ? parsed.model_answer_alt_en.trim() : '';
  const explanationKo = typeof parsed.explanation_ko === 'string' ? parsed.explanation_ko.trim() : '';
  const topicKo = typeof parsed.topic_ko === 'string' ? parsed.topic_ko.trim() : '';
  const wordMin = typeof parsed.word_min === 'number' ? parsed.word_min : 40;
  const wordMax = typeof parsed.word_max === 'number' ? parsed.word_max : 50;
  const points = typeof parsed.points === 'number' ? parsed.points : 8;

  if (!instructionIntroEn || !task1En || !task2En || !modelAnswerEn) {
    return { ok: false, error: '이중요지영작형 문항에 필수 항목(지시문/과제/답안)이 없습니다.' };
  }

  const qd: DualPointQuestionData = {
    InstructionIntroEn: instructionIntroEn,
    Task1En: task1En,
    Task2En: task2En,
    WordMin: wordMin,
    WordMax: wordMax,
    Points: points,
    ModelAnswerEn: modelAnswerEn,
    ModelAnswerAltEn: modelAnswerAltEn,
    ExplanationKo: explanationKo,
    TopicKo: topicKo,
  };
  return { ok: true, question_data: qd };
}

// ────────────────────────────────────────────
// 기존 유형 헬퍼
// ────────────────────────────────────────────

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
  const { paragraph, type, userHint, focusSentences, anthropicApiKey } = params;

  // focusSentences가 있으면 userHint 앞에 합성
  const focusBlock =
    focusSentences && focusSentences.length > 0
      ? `<서술형대비 중심 문장>\n${focusSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n</서술형대비 중심 문장>\n위 문장들을 핵심 근거로 삼아 출제하세요. (지문 전체 문맥은 그대로 사용)`
      : '';
  const composedHint = [focusBlock, userHint?.trim()].filter(Boolean).join('\n\n') || undefined;

  const client = new Anthropic({ apiKey: anthropicApiKey });

  // ── 새 유형: 별도 함수로 위임
  if (type === '빈칸재배열형') return generateBlankRearrangement(client, paragraph, composedHint);
  if (type === '요약문조건영작형') return generateSummaryConditional(client, paragraph, composedHint);
  if (type === '이중요지영작형') return generateDualPoint(client, paragraph, composedHint);

  // ── 기존 유형 (요약문본문어휘 / 요약문조건영작배열)
  const isArrangement = type === '요약문조건영작배열';

  let rawText: string;
  try {
    const systemPrompt = isArrangement
      ? ARRANGEMENT_SUMMARY_SYSTEM_PROMPT
      : PASSAGE_VOCAB_SUMMARY_SYSTEM_PROMPT;

    const userMessage = isArrangement
      ? buildArrangementUserMessage(paragraph, composedHint)
      : buildPassageVocabUserMessage(paragraph, composedHint);

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

// ────────────────────────────────────────────
// Claude Code CLI 프롬프트 빌더 (Pro 플랜 무과금 경로)
// ────────────────────────────────────────────

const ESSAY_TYPE_SCHEMA_HINT: Record<MemberEssayQuestionType, string> = {
  요약문본문어휘: `출력 키 (JSON 하나만, 마크다운 금지):
- Question (string) 발문 — 한국어
- Paragraph (string) 지문 원문 영어 그대로
- Conditions (string) 조건 목록 — 한국어, 줄바꿈(\\n) 구분
- SummaryFrame (string) 요약문 틀 (빈칸 2~3곳, ________)
- SampleAnswer (string) 모범 답안 완성 영어 문장
- Explanation (string) 한국어 해설 300자 이하
- Keywords (string[]) 각 빈칸 정답 단어 목록`,

  요약문조건영작배열: `출력 키 (JSON 하나만, 마크다운 금지):
- Question (string) 발문 — 한국어
- Paragraph (string) 지문 원문 영어 그대로
- Conditions (string) 조건 목록 — 한국어, 줄바꿈(\\n) 구분
- SummaryFrame (string) 요약문 틀 (빈칸 하나, ________)
- WordBank (string[]) 빈칸 채울 단어 무순서 6~9개
- SampleAnswer (string) 모범 답안 완성 영어 문장
- Explanation (string) 한국어 해설 300자 이하
- Keywords (string[]) 핵심 영단어 2~3개`,

  빈칸재배열형: `출력 키 (JSON 하나만, 마크다운 금지):
- phrase (string) 주제문장에서 발췌한 핵심 구 5~9단어
- chunks (string[]) 4~6개 청크 (셔플 배열)
- passage_with_blank (string) 원문 지문에서 구를 ________로 대체
- word_box (string) 셔플 순서 "chunk1 / chunk2 / …"
- explanation_ko (string) 한국어 해설 100자 이내`,

  요약문조건영작형: `출력 키 (JSON 하나만, 마크다운 금지):
- SummaryWithBlank (string) 빈칸(_______________) 포함 요약 문장
- Conditions (string[]) 조건 3개 배열
- Answer (string) 모범 답안 (빈칸 채운 구)
- AnswerAlt (string) 허용 답안
- ExplanationKo (string) 한국어 해설
- TopicKo (string) 주제 요약 짧은 한국어
- Points (number) 배점`,

  이중요지영작형: `출력 키 (JSON 하나만, 마크다운 금지):
- InstructionIntroEn (string) 도입 한 문장 영어
- Task1En (string) 하위 과제 1 소문자 간접절
- Task2En (string) 하위 과제 2
- WordMin (number) 최소 단어 수
- WordMax (number) 최대 단어 수
- Points (number) 배점
- ModelAnswerEn (string) 모범 답안
- ModelAnswerAltEn (string) 허용 답안
- ExplanationKo (string) 한국어 해설
- TopicKo (string) 주제 요약`,
};

/**
 * Claude Code 채팅에 붙여넣을 자연어 한 줄 명령 생성.
 * passage ID를 사용해 Claude Code가 MCP/CLI로 지문을 직접 조회하도록 합니다.
 * 이 함수는 서버 API 키를 사용하지 않으므로 Pro 플랜 무과금 경로에서 사용합니다.
 */
export function buildCliCommand(params: {
  passageId: string;
  /** 0-based 인덱스 배열 (화면 표시 번호 = index + 1) */
  selectedIndices: number[];
  type: MemberEssayQuestionType;
  userHint?: string;
}): string {
  const { passageId, selectedIndices, type, userHint } = params;

  const idxLabel =
    selectedIndices.length > 0
      ? `서술형대비 문장(${selectedIndices.map((i) => `인덱스 ${i + 1}`).join(', ')})을 중심으로 `
      : '';

  const hintPart =
    userHint && userHint.trim() ? ` 힌트: ${userHint.trim()}` : '';

  return `${passageId} 지문의 ${idxLabel}${type} 서술형 문제 1개 만들어 저장해줘.${hintPart}`;
}

/**
 * Claude Code CLI / 채팅 붙여넣기용 상세 프롬프트 생성 (지문 전문 포함).
 * passageId 없이 지문 텍스트만으로 사용할 때 씁니다.
 */
export function buildCliPromptForEssayDraft(params: {
  paragraph: string;
  type: MemberEssayQuestionType;
  focusSentences?: string[];
  userHint?: string;
}): string {
  const { paragraph, type, focusSentences, userHint } = params;

  const parts: string[] = [];
  parts.push(`다음 영어 지문을 바탕으로 **${type}** 유형의 서술형 문항 1개를 만들어 주세요.\n`);
  parts.push(`<지문>\n${paragraph.trim()}\n</지문>`);

  if (focusSentences && focusSentences.length > 0) {
    parts.push(
      `<서술형대비 중심 문장>\n${focusSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n</서술형대비 중심 문장>\n위 문장들을 핵심 근거로 삼아 출제하세요. (지문 전체 문맥은 그대로 사용)`
    );
  }

  if (userHint && userHint.trim()) {
    parts.push(`<추가 힌트>\n${userHint.trim()}\n</추가 힌트>`);
  }

  parts.push(ESSAY_TYPE_SCHEMA_HINT[type]);

  return parts.join('\n\n');
}
