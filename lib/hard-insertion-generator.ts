/**
 * 난이도 '상' 문장삽입 문제 생성기
 *
 * 기존(중): 원문에서 문장 1개를 추출 → 원래 위치를 찾는 문제
 * 신규(상): 원문 맥락에 맞는 새 문장을 생성 → 삽입 위치를 찾는 문제
 *
 * 두 가지 모드:
 *  A) Manual: Claude 채팅에서 문장을 생성 → buildFromManualSentence()로 question_data 구성
 *  B) Auto:   알고리즘으로 브릿지 문장을 생성 → buildHardInsertionQuestionData()
 */

/* ================================================================
 * 프롬프트 템플릿 — Claude 채팅(Pro)에서 참조
 * ================================================================ */

export const HARD_INSERTION_PROMPT = `
You are generating a BRAND-NEW insertion sentence for a Korean English exam (수능 문장삽입 유형, difficulty: 상).

## Key Difference from Normal (중) Insertion
- Normal (중): A sentence is EXTRACTED from the passage and students find its original position.
- Hard (상): You CREATE a completely new sentence that fits into the passage. The sentence must NOT exist anywhere in the original passage.

## Rules (8 rules)
1. **Originality**: The generated sentence must be ENTIRELY NEW. Do NOT copy, paraphrase, or reuse any sentence or clause from the passage. It must not overlap with or closely resemble any existing sentence in the passage.
2. **Demonstrative/Connector**: The sentence MUST contain a demonstrative (this, such, these) or a connector (however, therefore, as a result, in other words, consequently) that anchors it to the PREVIOUS sentence's specific content.
3. **Bridge Role**: The sentence must summarize or elaborate on the previous sentence AND naturally lead into the next sentence.
4. **Content Scope**: Do NOT introduce any new information, examples, names, or data not in the passage. Only rephrase, restate, or make explicit what is already implied.
5. **Length**: Exactly 1 sentence, 15–35 words.
6. **Distractor Appeal**: Include topic-level keywords from the passage so the sentence LOOKS plausible at other positions, but the demonstrative/connector should only fit at the target position.
7. **Position**: Prefer mid-to-late passage positions (between sentences 3–5 in a 6-sentence passage). Never place at the very beginning or end.
8. **Self-check**: Before finalizing, verify that (a) the generated sentence does not duplicate any part of the passage, (b) the demonstrative/connector clearly points to one specific preceding sentence, and (c) removing the sentence would not break the passage flow (since it was never there originally).

## Output Format
Output the full question as a JSON object with these keys:
{
  "순서": <number>,
  "Source": "",
  "NumQuestion": <number>,
  "Category": "삽입",
  "DifficultyLevel": "상",
  "Question": "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.",
  "Paragraph": "<generated sentence>\\n\\n<passage with ① ② ③ ④ ⑤ markers between sentences>",
  "Options": "① ### ② ### ③ ### ④ ### ⑤",
  "OptionType": "English",
  "CorrectAnswer": "<①~⑤>",
  "Explanation": "<한국어 해설, 600자 이하. 아래 4단계 구조를 반드시 따를 것.\n  ① '③이 정답입니다.'로 시작 (정답 번호에 맞게)\n  ② **글 전체 논리 흐름 요약** — 글이 어떤 논리 구조로 전개되는지 2~3문장으로 설명 (예: '이 글은 A라는 현상을 소개한 뒤, B라는 원인을 분석하고, C라는 결론으로 이어진다.')\n  ③ **삽입 위치 근거** — 정답 위치 앞 문장이 어떤 내용을 다루고, 주어진 문장의 지시어/연결어(this, such, however 등)가 구체적으로 무엇을 가리키며, 삽입 후 뒤 문장과 어떻게 연결되는지 설명>"
}
`.trim();

/* ================================================================
 * 유틸리티
 * ================================================================ */

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function selectInsertionPosition(sentenceCount: number, version: number): number {
  if (sentenceCount <= 4) return 2;

  const positions = [];
  const start = Math.max(2, Math.floor(sentenceCount * 0.4));
  const end = Math.min(sentenceCount - 1, Math.floor(sentenceCount * 0.8));
  for (let i = start; i <= end; i++) positions.push(i);

  if (positions.length === 0) return Math.floor(sentenceCount * 0.6);
  return positions[version % positions.length];
}

/* ================================================================
 * Mode A: Manual (Claude 채팅에서 문장 생성 후)
 * ================================================================ */

export interface ManualInsertionInput {
  sentences: string[];
  generatedSentence: string;
  position: number;
  explanationKo: string;
  source: string;
  version: number;
}

export function buildFromManualSentence(input: ManualInsertionInput): Record<string, unknown> {
  const { sentences, generatedSentence, position, explanationKo, source, version } = input;
  const circled = ['①', '②', '③', '④', '⑤'];

  const markedParts = buildMarkedParagraph(sentences);
  const paragraph = [generatedSentence, '###', markedParts].join('\n');
  const options = circled.map((c) => `${c}`).join('\n');
  const correctCircle = circled[position - 1] ?? circled[0];

  return {
    순서: version,
    Source: source,
    Category: '삽입',
    DifficultyLevel: '상',
    Question: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
    Paragraph: paragraph,
    Options: options,
    OptionType: 'English',
    CorrectAnswer: correctCircle,
    Explanation: explanationKo,
    GeneratedSentence: true,
  };
}

/* ================================================================
 * Mode B: Auto (알고리즘 기반 생성)
 * ================================================================ */

export function buildHardInsertionQuestionData(
  sentences: string[],
  source: string,
  version: number,
): Record<string, unknown> | null {
  if (sentences.length < 5) return null;

  const position = selectInsertionPosition(sentences.length, version);
  if (position < 1 || position >= sentences.length) return null;

  const prevSent = sentences[position - 1];
  const nextSent = sentences[position];

  const sentence = autoGenerateBridge(prevSent, nextSent, sentences, position, version);
  if (!sentence) return null;

  const explanation = buildAutoExplanation(position, sentence, prevSent, nextSent);

  return buildFromManualSentence({
    sentences,
    generatedSentence: sentence,
    position,
    explanationKo: explanation,
    source,
    version,
  });
}

/* ── 자동 브릿지 문장 생성 ── */

function autoGenerateBridge(
  _prevSent: string,
  _nextSent: string,
  _allSentences: string[],
  position: number,
  version: number,
): string | null {
  const seed = version * 17 + position * 11;

  const templates = [
    'This is particularly important because it lays the groundwork for addressing the challenges described in the rest of the passage.',
    'In other words, such an approach serves as the foundation for the broader argument presented here.',
    'This perspective, however, must be examined within the context of the larger issue being discussed.',
    'Without this, the effectiveness of the measures described below would be significantly diminished.',
    'As a result, this consideration becomes a necessary prerequisite for the developments that follow.',
    'Consequently, this point is essential to understanding the reasoning behind the subsequent claims.',
    'Such a view thus connects the preceding observation to the argument that comes next.',
    'This aspect not only reinforces the point made above but also sets the stage for what follows.',
    'This is precisely why the issue raised above has direct implications for the discussion that follows.',
    'Therefore, this idea can be seen as a critical bridge between the analysis above and the proposals below.',
  ];

  return templates[Math.abs(seed) % templates.length];
}

/* ── 자동 해설 생성 ── */

function buildAutoExplanation(
  position: number,
  generatedSentence: string,
  prevSent: string,
  nextSent: string,
): string {
  const circled = ['①', '②', '③', '④', '⑤'];
  const c = circled[position - 1] ?? circled[0];
  const demo = extractDemonstrative(generatedSentence);

  return [
    `${c}이 정답입니다.`,
    `${c} 바로 앞 문장에서 "${prevSent.slice(0, 60)}…"라고 서술하고 있는데,`,
    `주어진 문장의 '${demo}'가 이 내용을 직접적으로 받아 부연·정리하고 있습니다.`,
    `삽입된 문장 뒤에 이어지는 "${nextSent.slice(0, 60)}…"는`,
    `주어진 문장이 제시한 관점을 바탕으로 논의를 확장하므로 글의 흐름이 자연스럽게 이어집니다.`,
  ].join(' ');
}

function extractDemonstrative(sentence: string): string {
  const patterns = [
    /\b(this|these|those|such|that)\s+\w+/i,
    /\b(however|therefore|consequently|as a result|in other words|thus|moreover|furthermore|nevertheless|in contrast|for this reason)\b/i,
  ];
  for (const p of patterns) {
    const m = sentence.match(p);
    if (m) return m[0];
  }
  return 'this';
}

/* ── paragraph 마킹 ── */

function buildMarkedParagraph(sentences: string[]): string {
  const circled = ['①', '②', '③', '④', '⑤'];
  const parts: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    if (i > 0 && i <= 5) {
      parts.push(circled[i - 1]);
    }
    parts.push(sentences[i]);
  }
  if (sentences.length <= 5) {
    parts.push(circled[Math.min(sentences.length - 1, 4)]);
  }

  return parts.join(' ');
}

/* ── 컨텍스트 프리뷰 (배치 스크립트용) ── */

export function getInsertionContext(sentences: string[], version: number) {
  const position = selectInsertionPosition(sentences.length, version);
  return {
    position,
    totalSentences: sentences.length,
    prevSentence: sentences[position - 1] ?? '',
    nextSentence: sentences[position] ?? '',
    allSentences: sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
  };
}
