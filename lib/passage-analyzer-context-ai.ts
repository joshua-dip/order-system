/** 문맥 모드 — AI가 단어(토큰) 인덱스를 골라 contextSelectedWords에 쓸 때 사용 */

import {
  formatSentencesBlockForGrammarAi,
  grammarAiJsonToWordKeys,
  GRAMMAR_AI_SENTENCES_PLACEHOLDER,
  type GrammarAiSelectionRow,
} from '@/lib/passage-analyzer-grammar-ai';

/** 어법과 동일한 플레이스홀더(문장 블록 삽입 위치) */
export const CONTEXT_AI_SENTENCES_PLACEHOLDER = GRAMMAR_AI_SENTENCES_PLACEHOLDER;

export const DEFAULT_CONTEXT_AI_PROMPT = `당신은 수능 영어 지문의 **문맥 이해**를 돕는 교사입니다. 아래 문장들에서 문맥상 의미 파악·추론에 중요한 **단어**를 골라 주세요. (예: 대명사·지시어의 선행사 단서, 어휘 뜻이 문장·절 전체에 의해 결정되는 핵심 어휘, 논리·인과·대조·양보를 잇는 접속 표현, 담화 전환·요지 신호어, 빈칸·함의 문제로 이어질 수 있는 의미상 초점 단어 등)

${CONTEXT_AI_SENTENCES_PLACEHOLDER}

규칙:
- 각 문장의 단어는 공백으로 나눈 **0부터 시작하는 인덱스**만 사용합니다(맨끝 구두점은 해당 단어 토큰에 붙인 채로 셉니다).
- 어법 교정이 아니라 **의미·문맥 파악**에 도움이 되는 단어 위주로, 전체 지문 기준 **약 8~25개 단어** 정도가 되도록 핵심만 선택합니다.
- 응답은 JSON만 출력합니다.

응답 형식(예시):
{
  "selections": [
    { "sentenceIndex": 0, "wordIndices": [3, 7, 8] },
    { "sentenceIndex": 1, "wordIndices": [0, 12] }
  ]
}`;

export function buildContextAiUserContent(sentences: string[], customPrompt: string): string {
  const block = formatSentencesBlockForGrammarAi(sentences);
  const trimmed = customPrompt.trim();
  const base = trimmed || DEFAULT_CONTEXT_AI_PROMPT;
  if (base.includes(CONTEXT_AI_SENTENCES_PLACEHOLDER)) {
    return base.split(CONTEXT_AI_SENTENCES_PLACEHOLDER).join(block);
  }
  return `${base}\n\n[문장 목록]\n${block}`;
}

export type ContextAiSelectionRow = GrammarAiSelectionRow;

export function contextAiJsonToWordKeys(sentences: string[], selections: ContextAiSelectionRow[]): string[] {
  return grammarAiJsonToWordKeys(sentences, selections);
}
