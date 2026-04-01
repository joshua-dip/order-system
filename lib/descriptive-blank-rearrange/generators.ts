import type Anthropic from '@anthropic-ai/sdk';
import { phraseTo4To6Chunks, splitPhraseToChunks } from './chunks';
import type { ProblemTypeKey } from './meta';
import { PROBLEM_TYPE_KEYS } from './meta';
import type { BlankRearrangementProblem, PhraseChunks } from './types';
import {
  AFTER_BAD_STARTS,
  BAD_ENDING_WORDS,
  chunksRejoinToPhrase,
  collectRuleBasedCandidatesEasy,
  collectRuleBasedCandidatesHard,
  findPhraseInText,
  isTooEasyPhrase,
  mergeArticleChunks,
  mergeColonChunks,
  normalizeWhitespace,
  replaceFirst,
  sentenceIndexOfPhrase,
  shuffledWordBox,
  stripTrailingPunctuationForAnswer,
} from './utils';

async function userMessageText(
  anthropic: Anthropic,
  model: string,
  content: string,
  maxTokens: number,
): Promise<string> {
  const res = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  });
  const block = res.content[0];
  return block?.type === 'text' ? block.text : '';
}

function parsePhraseChunksLines(raw: string): { phrase: string; chunks: string[] } {
  let phrase = '';
  const chunks: string[] = [];
  const lines = raw.split('\n').map((ln) => ln.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.toUpperCase().startsWith('PHRASE:')) {
      phrase = line.split(':', 2)[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
      if (!phrase && i + 1 < lines.length) {
        phrase = lines[i + 1].trim().replace(/^["']|["']$/g, '');
        i += 1;
      }
      i += 1;
      continue;
    }
    if (line.toUpperCase().startsWith('CHUNKS:')) {
      let rest = line.split(':', 2)[1]?.trim() ?? '';
      if (!rest && i + 1 < lines.length) {
        rest = lines[i + 1];
        i += 1;
      }
      for (const part of rest.split('/')) {
        const t = part.trim().replace(/^["']|["']$/g, '');
        if (t) chunks.push(t);
      }
      i += 1;
      break;
    }
    i += 1;
  }
  return { phrase, chunks };
}

function isGoodEasy(text: string, phrase: string, exclude: string[] | undefined): boolean {
  if (exclude?.length) {
    const norm = normalizeWhitespace(phrase).toLowerCase();
    for (const ex of exclude) {
      if (normalizeWhitespace(ex).toLowerCase() === norm) return false;
    }
  }
  if (phrase.includes('__SKIP__')) return false;
  const p = phrase.trim();
  if (p.endsWith(',')) return false;
  if (p.includes('─') || p.includes('—')) return false;
  if (p.includes('(') || p.includes(')')) return false;
  if (/[.!?]\s/.test(p)) return false;
  const words = p.split(/\s+/);
  if (words.length < 5 || words.length > 9) return false;
  const lastW = (words[words.length - 1] ?? '').toLowerCase();
  if (BAD_ENDING_WORDS.has(lastW)) return false;
  if (words[words.length - 1]?.includes("'")) return false;
  const exact = findPhraseInText(text, phrase);
  if (exact) {
    const pos = text.indexOf(exact);
    if (pos >= 0) {
      const after = text.slice(pos + exact.length).trimStart().toLowerCase();
      for (const s of AFTER_BAD_STARTS) {
        if (after.startsWith(s)) return false;
      }
    }
  }
  if (isTooEasyPhrase(phrase)) return false;
  const sentIdx = sentenceIndexOfPhrase(text, phrase);
  if (sentIdx !== null && sentIdx < 2) return false;
  return true;
}

function isGoodHard(text: string, phrase: string, exclude: string[] | undefined): boolean {
  if (exclude?.length) {
    const norm = normalizeWhitespace(phrase).toLowerCase();
    for (const ex of exclude) {
      if (normalizeWhitespace(ex).toLowerCase() === norm) return false;
    }
  }
  if (phrase.includes('__SKIP__')) return false;
  const p = phrase.trim();
  if (p.endsWith(',')) return false;
  if (p.includes('─') || p.includes('—')) return false;
  if (p.includes('(') || p.includes(')')) return false;
  if (/[.!?]\s/.test(p)) return false;
  const words = p.split(/\s+/);
  if (words.length < 8 || words.length > 13) return false;
  const lastW = (words[words.length - 1] ?? '').toLowerCase();
  if (BAD_ENDING_WORDS.has(lastW)) return false;
  if (words[words.length - 1]?.includes("'")) return false;
  const exact = findPhraseInText(text, phrase);
  if (exact) {
    const pos = text.indexOf(exact);
    if (pos >= 0) {
      const after = text.slice(pos + exact.length).trimStart().toLowerCase();
      for (const s of AFTER_BAD_STARTS) {
        if (after.startsWith(s)) return false;
      }
    }
  }
  if (isTooEasyPhrase(phrase)) return false;
  const sentIdx = sentenceIndexOfPhrase(text, phrase);
  if (sentIdx !== null && sentIdx < 2) return false;
  return true;
}

function finalizeEasyParse(text: string, phrase: string, chunks: string[]): PhraseChunks | null {
  if (!phrase && chunks.length) {
    phrase = normalizeWhitespace(chunks.join(' '));
  }
  if (phrase && !chunks.length) {
    chunks = splitPhraseToChunks(phrase);
    if (chunks.length < 4 || chunks.length > 7) {
      chunks = phraseTo4To6Chunks(phrase);
    }
  }
  if (!phrase || !chunks.length) return null;
  let candidate = normalizeWhitespace(chunks.join(' '));
  let exact = findPhraseInText(text, phrase) ?? findPhraseInText(text, candidate);
  if (!exact) return null;
  phrase = exact;
  if (!chunksRejoinToPhrase(chunks, phrase)) {
    chunks = phraseTo4To6Chunks(phrase);
  }
  chunks = mergeColonChunks(chunks);
  let merged = mergeArticleChunks(chunks);
  if (merged.length >= 4) chunks = merged;
  if (chunks.length < 4 || chunks.length > 7) return null;
  if (!isGoodEasy(text, phrase, undefined)) return null;
  return { phrase, chunks };
}

function finalizeHardParse(text: string, phrase: string, chunks: string[]): PhraseChunks | null {
  if (!phrase && chunks.length) {
    phrase = normalizeWhitespace(chunks.join(' '));
  }
  if (phrase && !chunks.length) {
    chunks = mergeColonChunks(phrase.split(/\s+/));
  }
  if (!phrase || !chunks.length) return null;
  const candidate = normalizeWhitespace(chunks.join(' '));
  let exact = findPhraseInText(text, phrase) ?? findPhraseInText(text, candidate);
  if (!exact) return null;
  phrase = exact;
  if (!chunksRejoinToPhrase(chunks, phrase)) {
    chunks = mergeColonChunks(phrase.split(/\s+/));
  }
  if (chunks.length < 8 || chunks.length > 13) return null;
  if (!isGoodHard(text, phrase, undefined)) return null;
  return { phrase, chunks };
}

async function selectPhraseEasy(
  anthropic: Anthropic,
  model: string,
  text: string,
  prompts: { full: string; simple: string },
  exclude?: string[],
): Promise<PhraseChunks | null> {
  const exSuffix =
    exclude?.length ?? 0
      ? `\n\n⚠️ 다음 구는 이미 다른 유형에서 사용되었으므로 절대 선택하지 마세요: ${exclude!.join(' / ')}`
      : '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = (attempt === 1 ? prompts.simple : prompts.full) + exSuffix;
    const raw = await userMessageText(anthropic, model, content, 400);
    if (!raw) continue;
    let { phrase, chunks } = parsePhraseChunksLines(raw);
    const r = finalizeEasyParse(text, phrase, chunks);
    if (r) return r;
  }
  return null;
}

async function selectPhraseHard(
  anthropic: Anthropic,
  model: string,
  text: string,
  prompts: { full: string; simple: string },
  exclude?: string[],
): Promise<PhraseChunks | null> {
  const exSuffix =
    exclude?.length ?? 0
      ? `\n\n⚠️ 다음 구는 이미 다른 유형에서 사용되었으므로 절대 선택하지 마세요: ${exclude!.join(' / ')}`
      : '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = (attempt === 1 ? prompts.simple : prompts.full) + exSuffix;
    const raw = await userMessageText(anthropic, model, content, 400);
    if (!raw) continue;
    let { phrase, chunks } = parsePhraseChunksLines(raw);
    const r = finalizeHardParse(text, phrase, chunks);
    if (r) return r;
  }
  return null;
}

function ruleBasedFirstEasy(text: string): PhraseChunks | null {
  const cands = collectRuleBasedCandidatesEasy(text, (t, p) => isGoodEasy(t, p, undefined), splitPhraseToChunks);
  return cands[0] ?? null;
}

function ruleBasedRandomEasy(text: string): PhraseChunks | null {
  const cands = collectRuleBasedCandidatesEasy(text, (t, p) => isGoodEasy(t, p, undefined), splitPhraseToChunks);
  if (!cands.length) return null;
  return cands[Math.floor(Math.random() * cands.length)]!;
}

function ruleBasedFirstHard(text: string): PhraseChunks | null {
  const cands = collectRuleBasedCandidatesHard(text, (t, p) => isGoodHard(t, p, undefined));
  return cands[0] ?? null;
}

function ruleBasedRandomHard(text: string): PhraseChunks | null {
  const cands = collectRuleBasedCandidatesHard(text, (t, p) => isGoodHard(t, p, undefined));
  if (!cands.length) return null;
  return cands[Math.floor(Math.random() * cands.length)]!;
}

async function explainSubject(anthropic: Anthropic, model: string, text: string, answer: string, chunks: string[]) {
  const wordBox = chunks.join(' / ');
  const content = `다음 영어 지문의 빈칸에 들어갈 정답과 보기가 주어졌습니다. 학생을 위한 **해설**을 한국어로 작성해주세요.

정답: ${answer}
보기: ${wordBox}

지문 (일부):
${text.slice(0, 500)}

해설 작성 규칙:
1. 이 구가 **글의 주제와 어떻게 연결**되는지 한 문장으로 설명 (예: "글의 주제인 ~을 뒷받침하는 핵심 표현이다").
2. 정답 구의 **한국어 해석**을 한 문장으로 제시.
3. 배열의 **문법적 근거**(어순 규칙)를 한 문장으로 설명.
4. 총 3문장, 100자 내외로 간결하게. 서론·배경 설명 금지.
5. 해설만 출력하고 다른 형식(번호, 제목 등) 금지.`;
  try {
    return (await userMessageText(anthropic, model, content, 250)).trim();
  } catch {
    return '';
  }
}

async function explainGram(anthropic: Anthropic, model: string, text: string, answer: string, chunks: string[]) {
  const wordBox = chunks.join(' / ');
  const content = `다음 영어 지문의 빈칸에 들어갈 정답과 보기가 주어졌습니다. 학생을 위한 **해설**을 한국어로 작성해주세요.

정답: ${answer}
보기: ${wordBox}

지문 (일부):
${text.slice(0, 500)}

해설 작성 규칙:
1. 정답 구의 **한국어 해석**을 한 문장으로 제시.
2. 포함된 **어법 포인트**(관계절·분사·수동태·to부정사·동명사·비교급 등)를 명시하고, 배열의 **문법적 근거**를 한 문장으로 설명.
3. 총 2문장, 80자 내외로 간결하게. 주제·배경 설명 금지.
4. 해설만 출력하고 다른 형식(번호, 제목 등) 금지.`;
  try {
    return (await userMessageText(anthropic, model, content, 250)).trim();
  } catch {
    return '';
  }
}

async function explainSubjectLabeled(
  anthropic: Anthropic,
  model: string,
  text: string,
  answer: string,
  chunks: string[],
  label: string,
) {
  const wordBox = chunks.join(' / ');
  const labelDesc = label ? `빈칸 (${label})` : '빈칸';
  const content = `다음 영어 지문의 ${labelDesc}에 들어갈 정답과 보기가 주어졌습니다. 학생을 위한 **해설**을 한국어로 작성해주세요.

정답: ${answer}
보기: ${wordBox}

지문 (일부):
${text.slice(0, 500)}

해설 작성 규칙:
1. 이 구가 **글의 주제와 어떻게 연결**되는지 한 문장으로 설명 (예: "글의 주제인 ~을 뒷받침하는 핵심 표현이다").
2. 정답 구의 **한국어 해석**을 한 문장으로 제시.
3. 배열의 **문법적 근거**(어순 규칙)를 한 문장으로 설명.
4. 총 3문장, 100자 내외로 간결하게. 서론·배경 설명 금지.
5. 해설만 출력하고 다른 형식(번호, 제목 등) 금지.`;
  try {
    return (await userMessageText(anthropic, model, content, 250)).trim();
  } catch {
    return '';
  }
}

async function explainGramLabeled(
  anthropic: Anthropic,
  model: string,
  text: string,
  answer: string,
  chunks: string[],
  label: string,
) {
  const wordBox = chunks.join(' / ');
  const labelDesc = label ? `빈칸 (${label})` : '빈칸';
  const content = `다음 영어 지문의 ${labelDesc}에 들어갈 정답과 보기가 주어졌습니다. 학생을 위한 **해설**을 한국어로 작성해주세요.

정답: ${answer}
보기: ${wordBox}

지문 (일부):
${text.slice(0, 500)}

해설 작성 규칙:
1. 정답 구의 **한국어 해석**을 한 문장으로 제시.
2. 포함된 **어법 포인트**(관계절·분사·수동태·to부정사·동명사·비교급 등)를 명시하고, 배열의 **문법적 근거**를 한 문장으로 설명.
3. 총 2문장, 80자 내외로 간결하게. 주제·배경 설명 금지.
4. 해설만 출력하고 다른 형식(번호, 제목 등) 금지.`;
  try {
    return (await userMessageText(anthropic, model, content, 250)).trim();
  } catch {
    return '';
  }
}

const PROMPT_SUBJECT_EASY = {
  simple: (text: string) =>
    `Find the TOPIC SENTENCE (main claim/thesis) of this passage, then copy one phrase (5-9 words) from THAT sentence EXACTLY. Output only these two lines:

PHRASE:
[paste the exact phrase from the topic sentence]

CHUNKS:
[same words separated by /]

Passage:
${text}`,
  full: (text: string) =>
    `다음 영어 지문에서 **주제문**(글의 핵심 주장·요지·결론이 담긴 문장)을 찾고, 그 주제문 안에서 핵심 구(5~9단어)를 지문에 나온 그대로 복사해 넣고, 4~7개 덩어리(chunks)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 먼저 **주제문**을 찾을 것 — 글 전체의 핵심 메시지·결론·주장이 담긴 문장. 보통 첫 문장, 마지막 문장, 또는 역접(however, but, yet) 뒤 문장에 있음.
2. PHRASE는 그 **주제문 안에서만** 선택할 것. 예시·부연·근거 문장이 아닌, 핵심 주장 문장에서 골라야 함.
3. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함 (오타·공백 변경 금지).
4. 구 길이: 5~9단어.
5. CHUNKS는 위 구를 슬래시(/)로 구분. 합치면 PHRASE와 동일.
6. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게. 대시·괄호 포함 구 피할 것.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.** 세 번째 문장 이후에서만 선택.
8. 형식만 지키고 다른 설명 금지.

PHRASE:
[주제문에서 복사한 구 한 줄]

CHUNKS:
[chunk1] / [chunk2] / [chunk3] / ...
`,
};

const PROMPT_GRAM_EASY = {
  simple: (text: string) =>
    `Find the phrase (5-9 words) with the MOST DIFFICULT grammar structure to rearrange. Prioritize: relative clauses > participle constructions > passive + preposition > to-infinitive phrases > comparatives. Avoid simple patterns like "the N is" or "it is adj". Copy it EXACTLY from the passage. Output only these two lines:

PHRASE:
[paste the exact phrase here]

CHUNKS:
[same words separated by /]

Passage:
${text}`,
  full: (text: string) =>
    `다음 영어 지문에서 **어법상 중요한 구조**를 포함하는 구 하나를 지문에 나온 그대로 복사해 넣고, 4~7개 덩어리(chunks)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 지문에서 학생이 **영작할 때 어순 배열이 가장 까다로운** 구를 선택할 것. 난이도 우선순위:
   (최상) 관계대명사절 (which/who/that + 동사 + 목적어/보어)
   (상) 분사구문·분사 수식 (V-ing ~, p.p. ~ / 명사 + p.p. + 전치사구)
   (상) 수동태 + 전치사구 (be + p.p. + by/with/to ~)
   (중) to부정사구 (to + 동사원형 + 목적어 + 전치사구)
   (중) 비교급/최상급 (more ~ than / the most ~ / as ~ as)
   (하) 동명사구, 접속사+절 (although/because/while + S + V)
   ※ 위 순서대로 **난이도가 높은 구조를 최우선** 선택.
2. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함 (오타·공백 변경 금지).
3. 구 길이: 5~9단어.
4. CHUNKS는 위 구를 슬래시(/)로 구분. 합치면 PHRASE와 동일.
5. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게. 대시·괄호 포함 구 피할 것.
6. 단순 'the + 명사 + is', 'it is + 형용사' 같은 쉬운 패턴은 **절대 선택 금지**. 어순이 뒤섞였을 때 복원이 어려운 구를 골라야 함.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.** 세 번째 문장 이후에서만 선택.
8. 형식만 지키고 다른 설명 금지.

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[chunk1] / [chunk2] / [chunk3] / ...
`,
};

const PROMPT_SUBJECT_HARD = {
  simple: (text: string) =>
    `Find the TOPIC SENTENCE of this passage, then copy one phrase (8-13 words) from THAT sentence EXACTLY. Split into individual words separated by /.

PHRASE:
[paste 8-13 word phrase from the topic sentence]

CHUNKS:
[word1] / [word2] / [word3] / ... (each word separately)

Passage:
${text}`,
  full: (text: string) =>
    `다음 영어 지문에서 **주제문**(글의 핵심 주장·요지·결론이 담긴 문장)을 찾고, 그 주제문 안에서 긴 구(8~13단어)를 지문에 나온 그대로 복사해 넣고, **낱단어 하나씩** 슬래시(/)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 먼저 **주제문**을 찾을 것 — 글 전체의 핵심 메시지·결론·주장이 담긴 문장.
2. PHRASE는 그 **주제문 안에서만** 선택할 것.
3. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함 (오타·공백 변경 금지).
4. 구 길이: **8~13단어** (Hard 난이도).
5. CHUNKS는 **낱단어 하나씩** 슬래시(/)로 구분. 합치면 PHRASE와 동일.
6. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게. 대시·괄호 포함 구 피할 것.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.**
8. 형식만 지키고 다른 설명 금지.

PHRASE:
[주제문에서 복사한 구 한 줄]

CHUNKS:
[word1] / [word2] / [word3] / ...
`,
};

const PROMPT_GRAM_HARD = {
  simple: (text: string) =>
    `Find the phrase (8-13 words) with the MOST DIFFICULT grammar structure to rearrange. Prioritize: relative clauses > participle constructions > passive + preposition > to-infinitive phrases > comparatives. Avoid simple patterns like "the N is" or "it is adj". Copy it EXACTLY. Split into individual words separated by /.

PHRASE:
[paste 8-13 word phrase]

CHUNKS:
[word1] / [word2] / ... (each word separately)

Passage:
${text}`,
  full: (text: string) =>
    `다음 영어 지문에서 **어법상 중요한 구조**를 포함하는 긴 구(8~13단어) 하나를 지문에 나온 그대로 복사해 넣고, **낱단어 하나씩** 슬래시(/)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 지문에서 학생이 **영작할 때 어순 배열이 가장 까다로운** 구를 선택할 것. 난이도 우선순위:
   (최상) 관계대명사절 (which/who/that + 동사 + 목적어/보어)
   (상) 분사구문·분사 수식 (V-ing ~, p.p. ~ / 명사 + p.p. + 전치사구)
   (상) 수동태 + 전치사구 (be + p.p. + by/with/to ~)
   (중) to부정사구 (to + 동사원형 + 목적어 + 전치사구)
   (중) 비교급/최상급 (more ~ than / the most ~ / as ~ as)
   (하) 동명사구, 접속사+절 (although/because/while + S + V)
   ※ 위 순서대로 **난이도가 높은 구조를 최우선** 선택.
2. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함.
3. 구 길이: **8~13단어** (Hard 난이도).
4. CHUNKS는 **낱단어 하나씩** 슬래시(/)로 구분. 합치면 PHRASE와 동일.
5. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게.
6. 단순 'the + 명사 + is', 'it is + 형용사' 같은 쉬운 패턴은 **절대 선택 금지**. 어순이 뒤섞였을 때 복원이 어려운 구를 골라야 함.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.**
8. 형식만 지키고 다른 설명 금지.

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[word1] / [word2] / [word3] / ...
`,
};

function promptSubjectEasyDouble(text: string, forBlankB: boolean) {
  const extra =
    forBlankB && text.includes('__SKIP__')
      ? '\n8. Pick a phrase from a different sentence than __SKIP__, ideally 2-3 sentences away.'
      : '';
  const simpleExtra =
    forBlankB && text.includes('__SKIP__')
      ? ' Choose a phrase from a DIFFERENT sentence than __SKIP__, 2-3 sentences away.'
      : '';
  return {
    simple: `Find the TOPIC SENTENCE (main claim/thesis) of this passage, then copy one phrase (5-9 words) from THAT sentence or a closely related key sentence EXACTLY. Output only these two lines:

PHRASE:
[paste the exact phrase here]

CHUNKS:
[same words separated by /]${simpleExtra}

Passage:
${text}`,
    full: `다음 영어 지문에서 **주제문**(글의 핵심 주장·요지·결론이 담긴 문장) 또는 주제와 직결되는 핵심 문장을 찾고, 그 안에서 핵심 구(5~9단어)를 지문에 나온 그대로 복사해 넣고, 4~7개 덩어리(chunks)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 먼저 **주제문**을 찾을 것 — 글 전체의 핵심 메시지·결론·주장이 담긴 문장. 보통 첫 문장, 마지막 문장, 또는 역접(however, but, yet) 뒤 문장에 있음.
2. PHRASE는 그 **주제문 또는 주제와 직결되는 핵심 문장** 안에서 선택할 것. 예시·부연·근거 문장이 아닌, 핵심 주장 문장에서 골라야 함.
3. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함 (오타·공백 변경 금지).
4. 구 길이: 5~9단어.
5. CHUNKS는 위 구를 슬래시(/)로 구분. 합치면 PHRASE와 동일.
6. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게. 대시·괄호 포함 구 피할 것.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.** 세 번째 문장 이후에서만 선택.
8. 형식만 지키고 다른 설명 금지.${extra}

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[chunk1] / [chunk2] / [chunk3] / ...
`,
  };
}

function promptGramEasyDouble(text: string, forBlankB: boolean) {
  const extra =
    forBlankB && text.includes('__SKIP__')
      ? '\n8. Pick a phrase from a different sentence than __SKIP__, ideally 2-3 sentences away.'
      : '';
  const simpleExtra =
    forBlankB && text.includes('__SKIP__')
      ? ' Choose a phrase from a DIFFERENT sentence than __SKIP__, 2-3 sentences away.'
      : '';
  return {
    simple: `Find the phrase (5-9 words) with the MOST DIFFICULT grammar structure to rearrange. Prioritize: relative clauses > participle constructions > passive + preposition > to-infinitive phrases > comparatives. Avoid simple patterns like "the N is" or "it is adj". Copy it EXACTLY from the passage. Output only these two lines:

PHRASE:
[paste the exact phrase here]

CHUNKS:
[same words separated by /]${simpleExtra}

Passage:
${text}`,
    full: `다음 영어 지문에서 **어법상 중요한 구조**를 포함하는 구 하나를 지문에 나온 그대로 복사해 넣고, 4~7개 덩어리(chunks)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 지문에서 학생이 **영작할 때 어순 배열이 가장 까다로운** 구를 선택할 것. 난이도 우선순위:
   (최상) 관계대명사절 (which/who/that + 동사 + 목적어/보어)
   (상) 분사구문·분사 수식 (V-ing ~, p.p. ~ / 명사 + p.p. + 전치사구)
   (상) 수동태 + 전치사구 (be + p.p. + by/with/to ~)
   (중) to부정사구 (to + 동사원형 + 목적어 + 전치사구)
   (중) 비교급/최상급 (more ~ than / the most ~ / as ~ as)
   (하) 동명사구, 접속사+절 (although/because/while + S + V)
   ※ 위 순서대로 **난이도가 높은 구조를 최우선** 선택.
2. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함 (오타·공백 변경 금지).
3. 구 길이: 5~9단어.
4. CHUNKS는 위 구를 슬래시(/)로 구분. 합치면 PHRASE와 동일.
5. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게. 대시·괄호 포함 구 피할 것.
6. 단순 'the + 명사 + is', 'it is + 형용사' 같은 쉬운 패턴은 **절대 선택 금지**. 어순이 뒤섞였을 때 복원이 어려운 구를 골라야 함.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.** 세 번째 문장 이후에서만 선택.
8. 형식만 지키고 다른 설명 금지.${extra}

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[chunk1] / [chunk2] / [chunk3] / ...
`,
  };
}

function promptSubjectHardDouble(text: string, forBlankB: boolean) {
  const extraRule =
    forBlankB && text.includes('__SKIP__')
      ? '\n9. Pick a phrase from a different sentence than __SKIP__, ideally 2-3 sentences away.'
      : '';
  const simpleExtra =
    forBlankB && text.includes('__SKIP__')
      ? ' Choose from a DIFFERENT sentence than __SKIP__, 2-3 sentences away.'
      : '';
  return {
    simple: `Find the TOPIC SENTENCE (main claim/thesis) of this passage, then copy one phrase (8-13 words) from THAT sentence or a closely related key sentence EXACTLY. Split into individual words separated by /.

PHRASE:
[paste 8-13 word phrase]

CHUNKS:
[word1] / [word2] / ... (each word separately)${simpleExtra}

Passage:
${text}`,
    full: `다음 영어 지문에서 **주제문**(글의 핵심 주장·요지·결론이 담긴 문장) 또는 주제와 직결되는 핵심 문장을 찾고, 그 안에서 긴 구(8~13단어)를 지문에 나온 그대로 복사해 넣고, **낱단어 하나씩** 슬래시(/)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 먼저 **주제문**을 찾을 것 — 글 전체의 핵심 메시지·결론·주장이 담긴 문장.
2. PHRASE는 그 **주제문 또는 주제와 직결되는 핵심 문장** 안에서 선택할 것.
3. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함.
4. 구 길이: **8~13단어** (Hard 난이도).
5. CHUNKS는 **낱단어 하나씩** 슬래시(/)로 구분. 합치면 PHRASE와 동일.
6. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.**
8. 형식만 지키고 다른 설명 금지.${extraRule}

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[word1] / [word2] / [word3] / ...
`,
  };
}

function promptGramHardDouble(text: string, forBlankB: boolean) {
  const extraRule =
    forBlankB && text.includes('__SKIP__')
      ? '\n9. Pick a phrase from a different sentence than __SKIP__, ideally 2-3 sentences away.'
      : '';
  const simpleExtra =
    forBlankB && text.includes('__SKIP__')
      ? ' Choose from a DIFFERENT sentence than __SKIP__, 2-3 sentences away.'
      : '';
  return {
    simple: `Find the phrase (8-13 words) with the MOST DIFFICULT grammar structure to rearrange. Prioritize: relative clauses > participle constructions > passive + preposition > to-infinitive phrases > comparatives. Avoid simple patterns like "the N is" or "it is adj". Copy it EXACTLY. Split into individual words separated by /.

PHRASE:
[paste 8-13 word phrase]

CHUNKS:
[word1] / [word2] / ... (each word separately)${simpleExtra}

Passage:
${text}`,
    full: `다음 영어 지문에서 **어법상 중요한 구조**를 포함하는 긴 구(8~13단어) 하나를 지문에 나온 그대로 복사해 넣고, **낱단어 하나씩** 슬래시(/)로 나눠주세요.

영어 지문:
${text}

규칙:
1. 지문에서 학생이 **영작할 때 어순 배열이 가장 까다로운** 구를 선택할 것. 난이도 우선순위:
   (최상) 관계대명사절 (which/who/that + 동사 + 목적어/보어)
   (상) 분사구문·분사 수식 (V-ing ~, p.p. ~ / 명사 + p.p. + 전치사구)
   (상) 수동태 + 전치사구 (be + p.p. + by/with/to ~)
   (중) to부정사구 (to + 동사원형 + 목적어 + 전치사구)
   (중) 비교급/최상급 (more ~ than / the most ~ / as ~ as)
   (하) 동명사구, 접속사+절 (although/because/while + S + V)
   ※ 위 순서대로 **난이도가 높은 구조를 최우선** 선택.
2. PHRASE는 반드시 지문에 있는 연속된 단어를 **복사**한 것이어야 함.
3. 구 길이: **8~13단어** (Hard 난이도).
4. CHUNKS는 **낱단어 하나씩** 슬래시(/)로 구분. 합치면 PHRASE와 동일.
5. PHRASE 끝이 do, have, to, of, and 등으로 끝나지 않게.
6. 단순 'the + 명사 + is', 'it is + 형용사' 같은 쉬운 패턴은 **절대 선택 금지**. 어순이 뒤섞였을 때 복원이 어려운 구를 골라야 함.
7. **첫 번째 문장과 두 번째 문장에서는 절대 선택하지 말 것.**
8. 형식만 지키고 다른 설명 금지.${extraRule}

PHRASE:
[지문에서 복사한 구 한 줄]

CHUNKS:
[word1] / [word2] / [word3] / ...
`,
  };
}

async function selectPhraseEasyCustom(
  anthropic: Anthropic,
  model: string,
  text: string,
  prompts: { full: string; simple: string },
  exclude?: string[],
): Promise<PhraseChunks | null> {
  return selectPhraseEasy(anthropic, model, text, prompts, exclude);
}

async function selectPhraseHardCustom(
  anthropic: Anthropic,
  model: string,
  text: string,
  prompts: { full: string; simple: string },
  exclude?: string[],
): Promise<PhraseChunks | null> {
  return selectPhraseHard(anthropic, model, text, prompts, exclude);
}

async function buildOneBlank(
  anthropic: Anthropic,
  model: string,
  text: string,
  result: PhraseChunks,
  points: number,
  explainFn: typeof explainSubject,
): Promise<BlankRearrangementProblem[]> {
  let exactA = findPhraseInText(text, result.phrase) ?? result.phrase.trim();
  let chunksA = result.chunks;
  if (!chunksRejoinToPhrase(chunksA, result.phrase)) {
    const rejoined = chunksA.map((c) => c.trim()).join(' ');
    exactA = findPhraseInText(text, rejoined) ?? exactA;
  }
  if (!text.includes(exactA)) return [];
  let passage = replaceFirst(text, exactA, ' ___________ ');
  if (passage === text) passage = `${text}\n\n___________`;
  const answer = stripTrailingPunctuationForAnswer(exactA.trim());
  const explanation = await explainFn(anthropic, model, text, answer, chunksA);
  return [
    {
      original_text: text,
      passage_with_blank: passage,
      word_box: shuffledWordBox(chunksA),
      answer_phrase: answer,
      chunks: chunksA,
      points,
      blank_label: '',
      explanation,
    },
  ];
}

export async function generateBlankRearrangementSubject(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  const prompts = { full: PROMPT_SUBJECT_EASY.full(text), simple: PROMPT_SUBJECT_EASY.simple(text) };
  let result: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    result = await selectPhraseEasy(anthropic, model, text, prompts);
    if (result) break;
  }
  if (!result) result = ruleBasedFirstEasy(text);
  if (!result) return [];
  return buildOneBlank(anthropic, model, text, result, 2, explainSubject);
}

export async function generateBlankRearrangementGram(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  const prompts = { full: PROMPT_GRAM_EASY.full(text), simple: PROMPT_GRAM_EASY.simple(text) };
  let result: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    result = await selectPhraseEasy(anthropic, model, text, prompts);
    if (result) break;
  }
  if (!result) result = ruleBasedFirstEasy(text);
  if (!result) return [];
  return buildOneBlank(anthropic, model, text, result, 2, explainGram);
}

export async function generateBlankRearrangementSubjectHard(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  const prompts = { full: PROMPT_SUBJECT_HARD.full(text), simple: PROMPT_SUBJECT_HARD.simple(text) };
  let result: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    result = await selectPhraseHard(anthropic, model, text, prompts);
    if (result) break;
  }
  if (!result) result = ruleBasedFirstHard(text);
  if (!result) return [];
  return buildOneBlank(anthropic, model, text, result, 4, explainSubject);
}

export async function generateBlankRearrangementGramHard(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  const prompts = { full: PROMPT_GRAM_HARD.full(text), simple: PROMPT_GRAM_HARD.simple(text) };
  let result: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    result = await selectPhraseHard(anthropic, model, text, prompts);
    if (result) break;
  }
  if (!result) result = ruleBasedFirstHard(text);
  if (!result) return [];
  return buildOneBlank(anthropic, model, text, result, 4, explainGram);
}

async function generateDoubleEasy(
  anthropic: Anthropic,
  model: string,
  text: string,
  buildPrompts: (t: string, b: boolean) => { full: string; simple: string },
  explain: typeof explainSubjectLabeled,
  points: [number, number],
): Promise<BlankRearrangementProblem[]> {
  const pA = buildPrompts(text, false);
  let resultA: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    resultA = await selectPhraseEasyCustom(anthropic, model, text, pA);
    if (resultA) break;
  }
  if (!resultA) resultA = ruleBasedRandomEasy(text);
  if (!resultA) return [];

  let exactA = findPhraseInText(text, resultA.phrase) ?? resultA.phrase.trim();
  let chunksA = resultA.chunks;
  if (!chunksRejoinToPhrase(chunksA, resultA.phrase)) {
    const rejoined = chunksA.map((c) => c.trim()).join(' ');
    exactA = findPhraseInText(text, rejoined) ?? exactA;
  }
  let wordBoxA = shuffledWordBox(chunksA);
  let answerA = stripTrailingPunctuationForAnswer(exactA.trim());

  if (!text.includes(exactA)) return [];

  const textNoA = replaceFirst(text, exactA, ' __SKIP__ ');
  const idxA = sentenceIndexOfPhrase(text, exactA);

  let resultB: PhraseChunks | null = null;
  let exactB = '';
  let chunksB: string[] = [];

  for (let attemptB = 0; attemptB < 7; attemptB++) {
    const pB = buildPrompts(textNoA, true);
    let cand: PhraseChunks | null =
      attemptB < 5
        ? await selectPhraseEasyCustom(anthropic, model, textNoA, pB)
        : ruleBasedRandomEasy(textNoA);

    if (!cand || cand.phrase.includes('__SKIP__')) continue;

    let candExact = findPhraseInText(text, cand.phrase) ?? cand.phrase.trim();
    let candChunks = cand.chunks;
    if (!chunksRejoinToPhrase(candChunks, cand.phrase)) {
      const rejoined = candChunks.map((c) => c.trim()).join(' ');
      candExact = findPhraseInText(text, rejoined) ?? candExact;
    }

    const idxB = sentenceIndexOfPhrase(text, candExact);
    if (idxA !== null && idxB !== null && Math.abs(idxB - idxA) < 2) continue;

    resultB = cand;
    exactB = candExact;
    chunksB = candChunks;
    break;
  }

  if (!resultB) {
    for (let k = 0; k < 3; k++) {
      const cand = ruleBasedRandomEasy(textNoA);
      if (!cand || cand.phrase.includes('__SKIP__')) continue;
      let candExact = findPhraseInText(text, cand.phrase) ?? cand.phrase.trim();
      let candChunks = cand.chunks;
      if (!chunksRejoinToPhrase(candChunks, cand.phrase)) {
        const rejoined = candChunks.map((c) => c.trim()).join(' ');
        candExact = findPhraseInText(text, rejoined) ?? candExact;
      }
      const idxB = sentenceIndexOfPhrase(text, candExact);
      if (idxA !== null && idxB !== null && idxB === idxA) continue;
      resultB = cand;
      exactB = candExact;
      chunksB = candChunks;
      break;
    }
  }

  if (!resultB) return [];

  let posA = text.indexOf(exactA);
  let posB = text.indexOf(exactB);
  if (posB >= 0 && posA >= 0 && posB < posA) {
    [exactA, exactB] = [exactB, exactA];
    [chunksA, chunksB] = [chunksB, chunksA];
    wordBoxA = shuffledWordBox(chunksA);
    answerA = stripTrailingPunctuationForAnswer(exactA.trim());
  }

  const passageBoth = replaceFirst(
    replaceFirst(text, exactB, ' ___________ (B) ___________ '),
    exactA,
    ' ___________ (A) ___________ ',
  );

  const ptsB = points[1] ?? 4;
  const wordBoxB = shuffledWordBox(chunksB);
  const answerB = stripTrailingPunctuationForAnswer(exactB.trim());
  const explanationB = await explain(anthropic, model, text, answerB, chunksB, 'B');

  const problemB: BlankRearrangementProblem = {
    original_text: text,
    passage_with_blank: passageBoth,
    word_box: wordBoxB,
    word_box_other: wordBoxA,
    blank_label_other: 'A',
    answer_phrase: answerB,
    chunks: chunksB,
    points: ptsB,
    blank_label: 'B',
    explanation: explanationB,
  };

  const explanationA = await explain(anthropic, model, text, answerA, chunksA, 'A');
  const problemA: BlankRearrangementProblem = {
    original_text: text,
    passage_with_blank: passageBoth,
    word_box: wordBoxA,
    word_box_other: wordBoxB,
    blank_label_other: 'B',
    answer_phrase: answerA,
    chunks: chunksA,
    points: points[0] ?? 2,
    blank_label: 'A',
    explanation: explanationA,
  };

  return [problemA, problemB];
}

async function generateDoubleHard(
  anthropic: Anthropic,
  model: string,
  text: string,
  buildPrompts: (t: string, b: boolean) => { full: string; simple: string },
  explain: typeof explainSubjectLabeled,
  points: [number, number],
): Promise<BlankRearrangementProblem[]> {
  const pA = buildPrompts(text, false);
  let resultA: PhraseChunks | null = null;
  for (let i = 0; i < 3; i++) {
    resultA = await selectPhraseHardCustom(anthropic, model, text, pA);
    if (resultA) break;
  }
  if (!resultA) resultA = ruleBasedRandomHard(text);
  if (!resultA) return [];

  let exactA = findPhraseInText(text, resultA.phrase) ?? resultA.phrase.trim();
  let chunksA = resultA.chunks;
  if (!chunksRejoinToPhrase(chunksA, resultA.phrase)) {
    const rejoined = chunksA.map((c) => c.trim()).join(' ');
    exactA = findPhraseInText(text, rejoined) ?? exactA;
  }
  let wordBoxA = shuffledWordBox(chunksA);
  let answerA = stripTrailingPunctuationForAnswer(exactA.trim());

  if (!text.includes(exactA)) return [];

  const textNoA = replaceFirst(text, exactA, ' __SKIP__ ');
  const idxA = sentenceIndexOfPhrase(text, exactA);

  let resultB: PhraseChunks | null = null;
  let exactB = '';
  let chunksB: string[] = [];

  for (let attemptB = 0; attemptB < 7; attemptB++) {
    const pB = buildPrompts(textNoA, true);
    let cand: PhraseChunks | null =
      attemptB < 5
        ? await selectPhraseHardCustom(anthropic, model, textNoA, pB)
        : ruleBasedRandomHard(textNoA);

    if (!cand || cand.phrase.includes('__SKIP__')) continue;

    let candExact = findPhraseInText(text, cand.phrase) ?? cand.phrase.trim();
    let candChunks = cand.chunks;
    if (!chunksRejoinToPhrase(candChunks, cand.phrase)) {
      const rejoined = candChunks.map((c) => c.trim()).join(' ');
      candExact = findPhraseInText(text, rejoined) ?? candExact;
    }

    const idxB = sentenceIndexOfPhrase(text, candExact);
    if (idxA !== null && idxB !== null && Math.abs(idxB - idxA) < 2) continue;

    resultB = cand;
    exactB = candExact;
    chunksB = candChunks;
    break;
  }

  if (!resultB) {
    for (let k = 0; k < 3; k++) {
      const cand = ruleBasedRandomHard(textNoA);
      if (!cand || cand.phrase.includes('__SKIP__')) continue;
      let candExact = findPhraseInText(text, cand.phrase) ?? cand.phrase.trim();
      let candChunks = cand.chunks;
      if (!chunksRejoinToPhrase(candChunks, cand.phrase)) {
        const rejoined = candChunks.map((c) => c.trim()).join(' ');
        candExact = findPhraseInText(text, rejoined) ?? candExact;
      }
      const idxB = sentenceIndexOfPhrase(text, candExact);
      if (idxA !== null && idxB !== null && idxB === idxA) continue;
      resultB = cand;
      exactB = candExact;
      chunksB = candChunks;
      break;
    }
  }

  if (!resultB) return [];

  let posA = text.indexOf(exactA);
  let posB = text.indexOf(exactB);
  if (posB >= 0 && posA >= 0 && posB < posA) {
    [exactA, exactB] = [exactB, exactA];
    [chunksA, chunksB] = [chunksB, chunksA];
    wordBoxA = shuffledWordBox(chunksA);
    answerA = stripTrailingPunctuationForAnswer(exactA.trim());
  }

  const passageBoth = replaceFirst(
    replaceFirst(text, exactB, ' ___________ (B) ___________ '),
    exactA,
    ' ___________ (A) ___________ ',
  );

  const ptsB = points[1] ?? 6;
  const wordBoxB = shuffledWordBox(chunksB);
  const answerB = stripTrailingPunctuationForAnswer(exactB.trim());
  const explanationB = await explain(anthropic, model, text, answerB, chunksB, 'B');

  const problemB: BlankRearrangementProblem = {
    original_text: text,
    passage_with_blank: passageBoth,
    word_box: wordBoxB,
    word_box_other: wordBoxA,
    blank_label_other: 'A',
    answer_phrase: answerB,
    chunks: chunksB,
    points: ptsB,
    blank_label: 'B',
    explanation: explanationB,
  };

  const explanationA = await explain(anthropic, model, text, answerA, chunksA, 'A');
  const problemA: BlankRearrangementProblem = {
    original_text: text,
    passage_with_blank: passageBoth,
    word_box: wordBoxA,
    word_box_other: wordBoxB,
    blank_label_other: 'B',
    answer_phrase: answerA,
    chunks: chunksA,
    points: points[0] ?? 4,
    blank_label: 'A',
    explanation: explanationA,
  };

  return [problemA, problemB];
}

export async function generateBlankRearrangementBlank2Subject(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  return generateDoubleEasy(anthropic, model, text, promptSubjectEasyDouble, explainSubjectLabeled, [2, 4]);
}

export async function generateBlankRearrangementBlank2Gram(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  return generateDoubleEasy(anthropic, model, text, promptGramEasyDouble, explainGramLabeled, [2, 4]);
}

export async function generateBlankRearrangementBlank2SubjectHard(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  return generateDoubleHard(anthropic, model, text, promptSubjectHardDouble, explainSubjectLabeled, [4, 6]);
}

export async function generateBlankRearrangementBlank2GramHard(
  anthropic: Anthropic,
  model: string,
  text: string,
): Promise<BlankRearrangementProblem[]> {
  return generateDoubleHard(anthropic, model, text, promptGramHardDouble, explainGramLabeled, [4, 6]);
}

export async function generateByProblemTypeKey(
  key: ProblemTypeKey,
  anthropic: Anthropic,
  model: string,
  passageText: string,
): Promise<BlankRearrangementProblem[]> {
  switch (key) {
    case 'blank_rearrangement_subject':
      return generateBlankRearrangementSubject(anthropic, model, passageText);
    case 'blank_rearrangement_gram':
      return generateBlankRearrangementGram(anthropic, model, passageText);
    case 'blank_rearrangement_blank2_subject':
      return generateBlankRearrangementBlank2Subject(anthropic, model, passageText);
    case 'blank_rearrangement_blank2_gram':
      return generateBlankRearrangementBlank2Gram(anthropic, model, passageText);
    case 'blank_rearrangement_subject_hard':
      return generateBlankRearrangementSubjectHard(anthropic, model, passageText);
    case 'blank_rearrangement_gram_hard':
      return generateBlankRearrangementGramHard(anthropic, model, passageText);
    case 'blank_rearrangement_blank2_subject_hard':
      return generateBlankRearrangementBlank2SubjectHard(anthropic, model, passageText);
    case 'blank_rearrangement_blank2_gram_hard':
      return generateBlankRearrangementBlank2GramHard(anthropic, model, passageText);
    default:
      return [];
  }
}
