/**
 * 무관한문장 유형 문제 생성기
 *
 * 원문에 주제와 무관한 문장 1개를 생성하여 끼워넣고,
 * 학생이 전체 흐름과 관계없는 문장을 찾는 수능형 문항.
 *
 * 번호 부여 규칙:
 *  - 첫 문장은 도입부(맥락 제시)이므로 번호 없이 그대로 둔다.
 *  - 두 번째 문장부터 ①~⑤ 보기 번호를 부여한다.
 *  - 문장 수가 부족해 5개 보기를 채울 수 없을 때만 첫 문장에도 번호를 부여한다.
 */

import { splitSentences } from './hard-insertion-generator';

/* ================================================================
 * 프롬프트 템플릿 — Claude 채팅(Pro) / 초안 생성에서 참조
 * ================================================================ */

export const IRRELEVANT_SENTENCE_PROMPT = `
You are generating an IRRELEVANT SENTENCE question for a Korean English exam (수능 무관한문장 유형).

## What This Type Is
- The original passage has N sentences about a single topic.
- You CREATE one brand-new sentence that is **completely unrelated** to the passage topic.
- Insert it among the original sentences.
- The first sentence is left unnumbered as a lead-in; sentences from the second onward are labeled ①–⑤.
- The student must find which numbered sentence is irrelevant to the overall flow.

## Rules (7 rules)
1. **Topic Mismatch**: The irrelevant sentence must be about a COMPLETELY DIFFERENT topic from the passage. It should share NO thematic connection whatsoever.
2. **Stylistic Camouflage**: Despite the topic mismatch, the sentence must match the passage's tone, register, and vocabulary level (academic, informational, etc.) so it does not stand out on surface reading.
3. **Length**: 15–35 words, similar to the average sentence length in the passage.
4. **No Connectors Pointing Back**: The irrelevant sentence must NOT use demonstratives (this, these, such) or connectors (however, therefore, as a result) that reference surrounding sentences. It should read as a standalone factual statement.
5. **Insertion Position**: Place the irrelevant sentence at positions ②–④ (middle of the passage). Avoid ① and ⑤ unless necessary.
6. **Lead-in Sentence**: The first sentence of the passage is the lead-in and must NOT be numbered. Number assignment starts from the second sentence. Only if the passage has fewer than 6 sentences total should the first sentence also be numbered.
7. **Self-check**: Verify that (a) removing the irrelevant sentence leaves the passage perfectly coherent, (b) the irrelevant sentence has zero topical overlap with the passage, and (c) exactly 5 numbered sentences appear in the output.

## Output Format
Output the full question as a JSON object with these keys:
{
  "순서": <number>,
  "Source": "",
  "NumQuestion": <number>,
  "Category": "무관한문장",
  "DifficultyLevel": "중",
  "Question": "다음 글에서 전체 흐름과 관계없는 문장은?",
  "Paragraph": "<lead-in sentence without number> ① <sentence> ② <sentence> ③ <sentence> ④ <sentence> ⑤ <sentence>",
  "Options": "① ### ② ### ③ ### ④ ### ⑤",
  "OptionType": "English",
  "CorrectAnswer": "<①~⑤>",
  "Explanation": "<한국어 해설, 600자 이하. 아래 구조를 따를 것.\\n  ① '②가 정답입니다.'로 시작 (정답 번호에 맞게)\\n  ② 글 전체 흐름 요약 — 도입부와 각 번호 문장이 어떤 내용인지 2~3문장으로 설명\\n  ③ 정답 문장이 왜 무관한지 — 해당 문장의 주제가 글의 주제와 어떻게 다른지 명시>"
}

## Example

Passage topic: 인간의 기억 형성 과정

{
  "순서": 1,
  "Source": "",
  "NumQuestion": 1,
  "Category": "무관한문장",
  "DifficultyLevel": "중",
  "Question": "다음 글에서 전체 흐름과 관계없는 문장은?",
  "Paragraph": "Memory formation begins when sensory information enters the brain through various neural pathways. ① The hippocampus plays a crucial role in converting short-term memories into long-term ones through a process called consolidation. ② Coral reefs support approximately 25 percent of all marine species despite covering less than one percent of the ocean floor. ③ During sleep, the brain replays and strengthens neural connections that were formed during waking hours. ④ Repeated retrieval of information further reinforces these memory traces, making them more resistant to forgetting. ⑤ This is why consistent review is considered one of the most effective strategies for learning.",
  "Options": "① ### ② ### ③ ### ④ ### ⑤",
  "OptionType": "English",
  "CorrectAnswer": "②",
  "Explanation": "②가 정답입니다. 이 글은 기억이 형성되고 강화되는 과정을 설명하고 있습니다. 도입부에서 감각 정보가 뇌에 입력되는 것으로 시작하여, ①에서 해마가 단기기억을 장기기억으로 전환하는 과정을 설명하고, ③에서 수면 중 신경 연결이 강화되며, ④에서 반복적 인출이 기억 흔적을 공고히 하고, ⑤에서 꾸준한 복습이 효과적인 학습 전략인 이유로 마무리합니다. 그런데 ②는 산호초와 해양 생물에 관한 내용으로, 기억 형성이라는 글의 주제와 전혀 관련이 없는 문장입니다."
}
`.trim();

/* ================================================================
 * 유틸리티
 * ================================================================ */

const CIRCLED = ['①', '②', '③', '④', '⑤'];

/**
 * 무관한 문장의 삽입 위치(보기 번호 기준, 1-indexed)를 결정한다.
 * 중반부(②~④)를 선호하고, version에 따라 분산한다.
 */
export function selectIrrelevantPosition(choiceCount: number, version: number): number {
  const start = 2;
  const end = Math.min(choiceCount - 1, 4);
  const positions: number[] = [];
  for (let i = start; i <= end; i++) positions.push(i);
  if (positions.length === 0) return Math.min(2, choiceCount);
  return positions[version % positions.length];
}

/* ================================================================
 * Manual: Claude 채팅에서 무관한 문장을 직접 작성한 후 question_data 구성
 * ================================================================ */

export interface ManualIrrelevantInput {
  sentences: string[];
  irrelevantSentence: string;
  /** 보기 번호 기준 위치 (1 = ①) */
  position: number;
  explanationKo: string;
  source: string;
  version: number;
}

export function buildFromManualIrrelevant(input: ManualIrrelevantInput): Record<string, unknown> {
  const { sentences, irrelevantSentence, position, explanationKo, source, version } = input;

  const needFirstNumbered = sentences.length < 6;
  const allSentences = [...sentences];
  const insertIdx = needFirstNumbered ? position - 1 : position;
  allSentences.splice(insertIdx, 0, irrelevantSentence);

  const paragraph = buildNumberedParagraph(allSentences, needFirstNumbered);
  const correctCircle = CIRCLED[position - 1] ?? CIRCLED[0];

  return {
    순서: version,
    Source: source,
    Category: '무관한문장',
    DifficultyLevel: '중',
    Question: '다음 글에서 전체 흐름과 관계없는 문장은?',
    Paragraph: paragraph,
    Options: CIRCLED.join(' ### '),
    OptionType: 'English',
    CorrectAnswer: correctCircle,
    Explanation: explanationKo,
    GeneratedSentence: true,
  };
}

/* ================================================================
 * Auto: 템플릿 기반 무관한 문장 자동 생성
 * ================================================================ */

export function buildIrrelevantSentenceQuestionData(
  sentences: string[],
  source: string,
  version: number,
): Record<string, unknown> | null {
  if (sentences.length < 5) return null;

  const needFirstNumbered = sentences.length < 6;
  const choiceCount = 5;
  const position = selectIrrelevantPosition(choiceCount, version);

  const irrelevant = pickIrrelevantTemplate(version);
  const explanation = buildAutoExplanation(position, irrelevant, sentences);

  return buildFromManualIrrelevant({
    sentences,
    irrelevantSentence: irrelevant,
    position,
    explanationKo: explanation,
    source,
    version,
  });
}

/* ── 무관한 문장 템플릿 (다양한 주제) ── */

function pickIrrelevantTemplate(version: number): string {
  const templates = [
    'Coral reefs support approximately 25 percent of all marine species despite covering less than one percent of the ocean floor.',
    'The invention of the printing press in the 15th century fundamentally transformed the way knowledge was disseminated across Europe.',
    'Volcanic eruptions release large quantities of sulfur dioxide into the atmosphere, which can temporarily lower global temperatures.',
    'The migration patterns of monarch butterflies span thousands of miles across North America each year.',
    'Ancient Roman aqueducts were engineering marvels that transported water over long distances using gravity alone.',
    'The pH level of soil significantly affects which nutrients are available for plant absorption and growth.',
    'Deep-sea hydrothermal vents support unique ecosystems that thrive without sunlight through chemosynthesis.',
    'The development of radar technology during World War II later found widespread civilian applications in weather forecasting.',
    'Glacial ice cores provide valuable data about atmospheric composition spanning hundreds of thousands of years.',
    'The Fibonacci sequence appears frequently in natural structures such as the arrangement of leaves and flower petals.',
  ];

  return templates[Math.abs(version) % templates.length];
}

/* ── 자동 해설 ── */

function buildAutoExplanation(
  position: number,
  irrelevantSentence: string,
  originalSentences: string[],
): string {
  const c = CIRCLED[position - 1] ?? CIRCLED[0];
  const topicHint = originalSentences[0]?.slice(0, 50) ?? '';

  return [
    `${c}가 정답입니다.`,
    `이 글은 "${topicHint}…"로 시작하여 하나의 주제를 일관되게 전개하고 있습니다.`,
    `그런데 ${c}의 "${irrelevantSentence.slice(0, 60)}…"는`,
    `글의 주제와 전혀 관련이 없는 내용으로, 전체 흐름과 무관한 문장입니다.`,
  ].join(' ');
}

/* ── paragraph 번호 부여 ── */

function buildNumberedParagraph(allSentences: string[], firstNumbered: boolean): string {
  const parts: string[] = [];
  let circledIdx = 0;

  for (let i = 0; i < allSentences.length; i++) {
    if (i === 0 && !firstNumbered) {
      parts.push(allSentences[i]);
    } else {
      if (circledIdx < CIRCLED.length) {
        parts.push(`${CIRCLED[circledIdx]} ${allSentences[i]}`);
        circledIdx++;
      } else {
        parts.push(allSentences[i]);
      }
    }
  }

  return parts.join(' ');
}

/* ── re-export for convenience ── */
export { splitSentences } from './hard-insertion-generator';
