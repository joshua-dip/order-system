/** 어법 모드 — AI가 단어(토큰) 인덱스를 골라 grammarSelectedWords에 쓸 때 사용 */

export const GRAMMAR_AI_SENTENCES_PLACEHOLDER = '{{문장목록}}';

export const DEFAULT_GRAMMAR_AI_PROMPT = `당신은 수능 영어 지문의 어법·어휘·구문 분석을 돕는 교사입니다. 아래 문장들에서 **시험에 자주 나오는 중요 표현**(관계사·접속사, 대명사 지시, 수일치, 태·조동사, 전치사, 비교급/최상급, 분사·동명사·to부정사 구문, 도치, 생략, 관용 표현 등)에 해당하는 **단어**를 골라 주세요.

${GRAMMAR_AI_SENTENCES_PLACEHOLDER}

규칙:
- 각 문장의 단어는 공백으로 나눈 **0부터 시작하는 인덱스**만 사용합니다(맨끝 구두점은 해당 단어 토큰에 붙인 채로 셉니다).
- 한 문장에서 과도하게 고르지 말고, 전체 지문 기준 **약 8~25개 단어** 정도가 되도록 핵심만 선택합니다.
- 동일한 어법 포인트가 여러 단어에 걸치면 해당 단어 인덱스를 모두 나열합니다.
- 응답은 JSON만 출력합니다.

응답 형식(예시):
{
  "selections": [
    { "sentenceIndex": 0, "wordIndices": [3, 7, 8] },
    { "sentenceIndex": 1, "wordIndices": [0, 12] }
  ]
}`;

export function formatSentencesBlockForGrammarAi(sentences: string[]): string {
  return sentences.map((s, i) => `[${i}] ${s}`).join('\n');
}

/** 사용자 프롬프트에 문장 블록 삽입(플레이스홀더 없으면 하단에 붙임) */
export function buildGrammarAiUserContent(sentences: string[], customPrompt: string): string {
  const block = formatSentencesBlockForGrammarAi(sentences);
  const trimmed = customPrompt.trim();
  const base = trimmed || DEFAULT_GRAMMAR_AI_PROMPT;
  if (base.includes(GRAMMAR_AI_SENTENCES_PLACEHOLDER)) {
    return base.split(GRAMMAR_AI_SENTENCES_PLACEHOLDER).join(block);
  }
  return `${base}\n\n[문장 목록]\n${block}`;
}

export type GrammarAiSelectionRow = { sentenceIndex: number; wordIndices: number[] };

export function grammarAiJsonToWordKeys(
  sentences: string[],
  selections: GrammarAiSelectionRow[]
): string[] {
  const keys = new Set<string>();
  for (const row of selections || []) {
    let si = Math.floor(Number(row.sentenceIndex));
    if (!Number.isFinite(si) || si < 0 || si >= sentences.length) continue;
    const sentence = sentences[si] || '';
    const words = sentence.split(/\s+/).filter(Boolean);
    const max = words.length - 1;
    for (const w of row.wordIndices || []) {
      const wi = Math.floor(Number(w));
      if (!Number.isFinite(wi) || wi < 0 || wi > max) continue;
      keys.add(`${si}:${wi}`);
    }
  }
  return Array.from(keys).sort((a, b) => {
    const [as, aw] = a.split(':').map(Number);
    const [bs, bw] = b.split(':').map(Number);
    return as !== bs ? as - bs : aw - bw;
  });
}
