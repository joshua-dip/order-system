import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_PROMPTS: Record<number, string> = {
  1: '이 글의 주제를 한글로 작성한다면?',
  2: '이 글의 주제 1문장 또는 2문장을 입력한 지문 그대로 출력한다면?',
  3: '이 글을 영문으로 10-15단어로 요약한다면?',
  4: '3번에서 요약한 영문을 한글로 번역한다면?',
  5: `지문에서 문맥상 겉으로 드러난 의미 외에, 더 깊은 의미를 유추해야 하는 문장이나 구절을 1개 추출하시오.
이때, 다음의 조건을 고려하여 표현을 선정하시오:
- 문맥에 따라 함축적 의미나 암시가 담긴 표현일 것
- 윤리적 판단, 경고, 우려, 이상과 현실의 괴리 등 독자의 해석이 필요한 의미가 있을 것`,
};

/** 항목별 언어가 없을 때만 쓰는 공통 안내(레거시 단일 outputLang 경로) */
const LANG_NOTE_KO =
  '\n\n[출력 언어] 설명·해석은 한글로 작성하세요. (영문 요약·원문 발췌 등 항목 지시가 영문인 부분은 그대로 따르세요.)';

const LANG_NOTE_EN =
  '\n\n[Output language] Write explanations and interpretations in English, except: item 2 must be verbatim from the passage; item 3 must be English; item 4 should be Korean translation of item 3 as labeled.';

export const COMPREHENSIVE_ITEM_LABELS: Record<string, string> = {
  '1': '① 한글 주제',
  '2': '② 원문 주제문장',
  '3': '③ 영문 요약',
  '4': '④ 한글 번역',
  '5': '⑤ 함축적 표현',
};

/** 6번째 이상 슬롯 기본 안내(입력란에 질문을 적도록 유도) */
export const COMPREHENSIVE_EXTRA_SLOT_HINT =
  '이 항목에서 지문에 대해 다루고 싶은 질문·분석 지시를 구체적으로 작성하세요.';

const MAX_COMPREHENSIVE_SLOTS = 30;

export function clampComprehensiveSlotCount(n: number | undefined | null): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 5;
  return Math.min(MAX_COMPREHENSIVE_SLOTS, Math.max(5, v));
}

export function effectiveSlotOutputLang(
  index: number,
  bySlot: Record<string, unknown> | undefined | null,
  legacyLang: 'ko' | 'en'
): 'ko' | 'en' {
  const raw = bySlot?.[String(index)];
  return raw === 'en' || raw === 'ko' ? raw : legacyLang;
}

/** API·클라이언트에서 온 항목별 언어를 길이 sc의 배열로 정규화 */
export function normalizeSlotOutputLangs(
  slotCount: number,
  bySlot?: Record<string, unknown> | null,
  legacyLang?: 'ko' | 'en' | null
): ('ko' | 'en')[] {
  const sc = clampComprehensiveSlotCount(slotCount);
  const legacy = legacyLang === 'en' ? 'en' : 'ko';
  const arr: ('ko' | 'en')[] = [];
  for (let i = 1; i <= sc; i++) {
    arr.push(effectiveSlotOutputLang(i, bySlot ?? null, legacy));
  }
  return arr;
}

function buildResponseFormatKo(slotCount: number): string {
  const head = `응답 형식:
1. 한글 주제: [주제 설명]
2. 원문 주제문장: [지문에서 그대로 발췌한 1-2문장]
3. 영문 요약: [10-15단어 영문 요약]
4. 한글 번역: [3번의 번역]
5. 함축적 표현: [선정된 구절] - [의미 해석]`;
  const tail = '\n\n※ 각 항목의 출력 언어는 위 "분석 항목"의 지시에 따릅니다.';
  if (slotCount <= 5) return head + tail;
  const extra: string[] = [];
  for (let i = 6; i <= slotCount; i++) {
    extra.push(`${i}. 항목 ${i}: [답변]`);
  }
  return `${head}
${extra.join('\n')}${tail}`;
}


function promptTextForSlot(i: number, customPrompts?: Record<string, string>): string {
  const custom = customPrompts?.[String(i)]?.trim();
  if (custom) return custom;
  if (DEFAULT_PROMPTS[i]) return DEFAULT_PROMPTS[i]!;
  return COMPREHENSIVE_EXTRA_SLOT_HINT;
}

function buildPerSlotAnswerLangBlock(slotLangs: ('ko' | 'en')[]): string {
  const lines = slotLangs.map((lang, idx) => {
    const n = idx + 1;
    return lang === 'en' ? `- ${n}번: 답변 본문은 영어(English)로만` : `- ${n}번: 답변 본문은 한글로만`;
  });
  return `[항목별 답변 언어 — 각 번호는 반드시 아래 언어로만 답하세요]\n${lines.join('\n')}`;
}

function buildPromptFromParts(
  passage: string,
  customPrompts: Record<string, string> | undefined,
  slotLangs: ('ko' | 'en')[],
  slotCount: number
): string {
  const sc = clampComprehensiveSlotCount(slotCount);
  const langs =
    slotLangs.length === sc ? slotLangs : normalizeSlotOutputLangs(sc, null, slotLangs[0] || 'ko');
  const parts: string[] = [];
  for (let i = 1; i <= sc; i++) {
    const lang = langs[i - 1]!;
    const tail =
      lang === 'en'
        ? ' (이 항목의 답변 본문은 영어로 작성하세요.)'
        : ' (이 항목의 답변 본문은 한글로 작성하세요.)';
    parts.push(`${i}. ${promptTextForSlot(i, customPrompts)}${tail}`);
  }
  const responseFmt = buildResponseFormatKo(sc);
  const langBlock = buildPerSlotAnswerLangBlock(langs);
  return `다음 영어 지문을 분석하여 아래 ${sc}가지 항목에 대해 답변해주세요:

영어 지문:
${passage}

분석 항목:
${parts.join('\n')}

${langBlock}

${responseFmt}

※ 각 줄의 레이블(예: "1. 한글 주제:", "6. 항목 6:")은 위 응답 형식과 동일하게 유지하고, 콜론(또는 전각 ：) 뒤의 내용만 위 항목별 언어 지시를 따르세요.`;
}

type CompSectionKey =
  | 'koreanTopic'
  | 'originalSentence'
  | 'englishSummary'
  | 'koreanTranslation'
  | 'implicitMeaning';

const LINE_PATTERNS_KO: { section: CompSectionKey; re: RegExp }[] = [
  { section: 'koreanTopic', re: /1\.\s*한글\s*주제/i },
  { section: 'originalSentence', re: /2\.\s*원문\s*주제문장/i },
  { section: 'englishSummary', re: /3\.\s*영문\s*요약/i },
  { section: 'koreanTranslation', re: /4\.\s*한글\s*번역/i },
  { section: 'implicitMeaning', re: /5\.\s*함축적\s*(?:표현|의미)/i },
];

const LINE_PATTERNS_EN: { section: CompSectionKey; re: RegExp }[] = [
  { section: 'koreanTopic', re: /1\.\s*Topic\s*\(Korean\)/i },
  { section: 'originalSentence', re: /2\.\s*Key\s*quote/i },
  { section: 'englishSummary', re: /3\.\s*English\s*summary/i },
  { section: 'koreanTranslation', re: /4\.\s*Korean\s*translation/i },
  { section: 'implicitMeaning', re: /5\.\s*Implicit\s*meaning/i },
];

export function parseComprehensiveResponse(text: string, _slotCount: number = 5): Record<string, string> {
  const result: Record<string, string> = {};
  const patterns = [
    { key: 'koreanTopic', regex: /(?:1\.\s*)?한글\s*주제\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'originalSentence', regex: /(?:2\.\s*)?원문\s*주제문장\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'englishSummary', regex: /(?:3\.\s*)?영문\s*요약\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'koreanTranslation', regex: /(?:4\.\s*)?한글\s*번역\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'implicitMeaning', regex: /(?:5\.\s*)?함축적\s*(?:표현|의미)\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'koreanTopic', regex: /(?:1\.\s*)?Topic\s*\(Korean\)\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'originalSentence', regex: /(?:2\.\s*)?Key\s*quote[^\n:]*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'englishSummary', regex: /(?:3\.\s*)?English\s*summary\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'koreanTranslation', regex: /(?:4\.\s*)?Korean\s*translation\s*[:：]\s*(.+?)(?=\n|$)/i },
    { key: 'implicitMeaning', regex: /(?:5\.\s*)?Implicit\s*meaning\s*[:：]\s*(.+?)(?=\n|$)/i },
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match?.[1] && !result[pattern.key]) result[pattern.key] = match[1].trim();
  }
  const flushLineParse = (lineSets: { section: CompSectionKey; re: RegExp }[]) => {
    const lines = text.split('\n');
    let currentSection: CompSectionKey | '' = '';
    let currentContent = '';
    for (const line of lines) {
      const trimmedLine = line.trim();
      let matched: CompSectionKey | null = null;
      for (const { section, re } of lineSets) {
        if (trimmedLine.match(re)) {
          matched = section;
          break;
        }
      }
      if (matched) {
        if (currentSection && currentContent && !result[currentSection]) {
          result[currentSection] = currentContent.trim();
        }
        currentSection = matched;
        currentContent = trimmedLine.replace(/^.*?[:：]\s*/i, '').replace(/^\d+\.\s*/, '');
      } else if (currentSection && trimmedLine) {
        currentContent += (currentContent ? ' ' : '') + trimmedLine;
      }
    }
    if (currentSection && currentContent && !result[currentSection]) {
      result[currentSection] = currentContent.trim();
    }
  };
  flushLineParse(LINE_PATTERNS_KO);
  flushLineParse(LINE_PATTERNS_EN);

  const sc = clampComprehensiveSlotCount(_slotCount);
  if (sc > 5) {
    const extra = parseExtraComprehensiveSlots(text, sc);
    for (const [k, v] of Object.entries(extra)) {
      if (v && !result[k]) result[k] = v;
    }
  }

  return result;
}

function parseExtraComprehensiveSlots(text: string, slotCount: number): Record<string, string> {
  const out: Record<string, string> = {};
  const sc = clampComprehensiveSlotCount(slotCount);
  if (sc <= 5) return out;

  const lines = text.split('\n');
  let current: number | null = null;
  const buf: string[] = [];

  const flush = () => {
    if (current != null && current >= 6 && current <= sc) {
      const joined = buf.join('\n').trim();
      if (joined) out[`item_${current}`] = joined;
    }
    buf.length = 0;
  };

  const headerMatch = (trimmed: string, i: number): boolean => {
    const ko = new RegExp(`^${i}\\.\\s*항목\\s*${i}\\b`, 'i').test(trimmed);
    const en = new RegExp(`^${i}\\.\\s*Item\\s*${i}\\b`, 'i').test(trimmed);
    return ko || en;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    let hit: number | null = null;
    for (let i = 6; i <= sc; i++) {
      if (headerMatch(trimmed, i)) {
        hit = i;
        break;
      }
    }
    if (hit != null) {
      flush();
      current = hit;
      const after = trimmed
        .replace(new RegExp(`^${hit}\\.\\s*(?:항목\\s*${hit}|Item\\s*${hit})\\s*[:：]\\s*`, 'i'), '')
        .trim();
      if (after) buf.push(after);
    } else if (current != null && current >= 6) {
      buf.push(line);
    }
  }
  flush();

  for (let i = 6; i <= sc; i++) {
    const key = `item_${i}`;
    if (out[key]) continue;
    const boundary = i < sc ? `(?=\\n\\s*${i + 1}\\.\\s)` : '$';
    const koBody = `(?:^|\\n)${i}\\.\\s*항목\\s*${i}\\s*[:：]\\s*([\\s\\S]*?)${boundary}`;
    const enBody = `(?:^|\\n)${i}\\.\\s*Item\\s*${i}\\s*[:：]\\s*([\\s\\S]*?)${boundary}`;
    let m = text.match(new RegExp(koBody, 'im'));
    if (!m) m = text.match(new RegExp(enBody, 'im'));
    if (m?.[1]?.trim()) out[key] = m[1].trim();
  }

  return out;
}

export async function runComprehensiveAnalysis(
  anthropic: Anthropic,
  model: string,
  passage: string,
  customPrompt?: string,
  customPrompts?: Record<string, string>,
  /** outputLangBySlot이 없을 때 전 항목 기본값 */
  legacyOutputLang: 'ko' | 'en' = 'ko',
  slotOutputLangs?: ('ko' | 'en')[],
  slotCount?: number
): Promise<Record<string, string> | { error: string }> {
  const sc = clampComprehensiveSlotCount(slotCount);
  const langs =
    slotOutputLangs && slotOutputLangs.length === sc
      ? slotOutputLangs
      : normalizeSlotOutputLangs(sc, null, legacyOutputLang);
  let promptText: string;
  if (typeof customPrompt === 'string' && customPrompt.trim()) {
    promptText = customPrompt.replace(/\{\{지문\}\}/g, passage).trim();
    promptText += `\n\n${buildPerSlotAnswerLangBlock(langs)}`;
    const allKo = langs.every((l) => l === 'ko');
    const allEn = langs.every((l) => l === 'en');
    if (allEn) promptText += LANG_NOTE_EN;
    else if (allKo) promptText += LANG_NOTE_KO;
    else
      promptText +=
        '\n\n[출력] 항목마다 위에 지정된 언어만 사용하세요. (영문 요약·원문 발췌 등 해당 항목 지시가 다른 언어를 요구하면 그 지시를 우선합니다.)';
  } else if (customPrompts && typeof customPrompts === 'object' && Object.keys(customPrompts).length > 0) {
    promptText = buildPromptFromParts(passage, customPrompts, langs, sc);
  } else {
    promptText = buildPromptFromParts(passage, undefined, langs, sc);
  }

  const maxTokens = Math.min(4096, 500 + sc * 150);

  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: promptText }],
  });
  const response = message.content[0];
  if (response.type === 'text') {
    return parseComprehensiveResponse(response.text, sc);
  }
  return { error: '분석 결과를 생성할 수 없습니다.' };
}

export async function runIndividualAnalysis(
  anthropic: Anthropic,
  model: string,
  passage: string,
  analysisType: string
): Promise<Record<string, string> | { error: string }> {
  let prompt = '';
  switch (analysisType) {
    case 'korean-topic':
      prompt = `다음 영어 지문의 주제를 한글로 작성해주세요:\n\n${passage}\n\n응답: [한글 주제]`;
      break;
    case 'original-sentence':
      prompt = `다음 영어 지문에서 주제를 나타내는 1-2문장을 그대로 발췌해주세요:\n\n${passage}\n\n응답: [원문 발췌]`;
      break;
    case 'english-summary':
      prompt = `다음 영어 지문을 10-15단어로 영문 요약해주세요:\n\n${passage}\n\n응답: [영문 요약]`;
      break;
    case 'korean-translation':
      prompt = `다음 영어 지문을 10-15단어로 요약한 후 한글로 번역해주세요:\n\n${passage}\n\n응답: [한글 번역]`;
      break;
    case 'implicit-meaning':
      prompt = `다음 영어 지문에서 함축적 의미나 암시가 담긴 표현을 1개 추출하고 그 의미를 해석해주세요:\n\n${passage}`;
      break;
    default:
      return { error: '잘못된 분석 타입입니다.' };
  }
  const message = await anthropic.messages.create({
    model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  const response = message.content[0];
  if (response.type === 'text') {
    return { [analysisType]: response.text.trim() };
  }
  return { error: '분석 결과를 생성할 수 없습니다.' };
}
