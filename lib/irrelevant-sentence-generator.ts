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
8. **No Repetition**: Each question for the same passage MUST use a DIFFERENT irrelevant sentence with a completely different topic. Never reuse the same sentence or even the same subject area across different versions of the same passage's questions.

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
  "Options": "",
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
  "Options": "",
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
    Options: '',
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

  const irrelevant = pickIrrelevantTemplate(version, source);
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

/* ── 무관한 문장 템플릿 풀 (주제별 분류, 100+개) ── */

export const IRRELEVANT_TEMPLATES: string[] = [
  // 자연과학 — 해양/지구
  'Coral reefs support approximately 25 percent of all marine species despite covering less than one percent of the ocean floor.',
  'Deep-sea hydrothermal vents support unique ecosystems that thrive without sunlight through chemosynthesis.',
  'The Mariana Trench reaches a depth of nearly 36,000 feet, making it the deepest known point in the ocean.',
  'Ocean currents distribute heat around the globe and play a critical role in regulating regional climates.',
  'Tidal pools along rocky coastlines serve as miniature ecosystems where diverse marine organisms coexist.',
  'The salinity of seawater averages about 35 parts per thousand, varying slightly by region and depth.',

  // 자연과학 — 지질/화산/기후
  'Volcanic eruptions release large quantities of sulfur dioxide into the atmosphere, which can temporarily lower global temperatures.',
  'Glacial ice cores provide valuable data about atmospheric composition spanning hundreds of thousands of years.',
  'Tectonic plates move at a rate of a few centimeters per year, gradually reshaping the continents over millions of years.',
  'The formation of stalactites and stalagmites in limestone caves can take thousands of years of mineral deposition.',
  'Permafrost in Arctic regions stores roughly twice as much carbon as is currently present in the atmosphere.',
  'Earthquakes along the Pacific Ring of Fire account for approximately 90 percent of all seismic activity worldwide.',

  // 자연과학 — 생물/생태
  'The migration patterns of monarch butterflies span thousands of miles across North America each year.',
  'The pH level of soil significantly affects which nutrients are available for plant absorption and growth.',
  'The Fibonacci sequence appears frequently in natural structures such as the arrangement of leaves and flower petals.',
  'Certain species of bamboo can grow up to 91 centimeters in a single day under optimal conditions.',
  'Mycorrhizal fungi form symbiotic relationships with plant roots, helping them absorb water and essential nutrients.',
  'The average lifespan of a worker honeybee during summer is only about six weeks due to the intensity of foraging.',
  'Electric eels can generate up to 860 volts of electricity to stun prey and defend against predators.',
  'A single colony of leafcutter ants may contain over eight million individuals working in a complex division of labor.',
  'Chameleons change color primarily to regulate body temperature and communicate with other chameleons, not for camouflage.',
  'The axolotl, a Mexican salamander, can regenerate entire limbs, parts of its heart, and even sections of its brain.',
  'Tardigrades can survive extreme conditions, including the vacuum of outer space and temperatures near absolute zero.',
  'Blue whales are the largest animals ever known to have lived, with hearts roughly the size of a small car.',

  // 역사/문명
  'Ancient Roman aqueducts were engineering marvels that transported water over long distances using gravity alone.',
  'The invention of the printing press in the 15th century fundamentally transformed the way knowledge was disseminated across Europe.',
  'The development of radar technology during World War II later found widespread civilian applications in weather forecasting.',
  'The construction of the Great Pyramid of Giza required an estimated 2.3 million limestone blocks over a period of about 20 years.',
  'The Rosetta Stone, discovered in 1799, was the key to deciphering Egyptian hieroglyphics after centuries of mystery.',
  'The Silk Road facilitated not only trade in goods but also the exchange of ideas, religions, and technologies across continents.',
  'The Library of Alexandria, one of the ancient world\'s largest centers of learning, is believed to have housed hundreds of thousands of scrolls.',
  'Viking longships were designed with shallow drafts, allowing them to navigate both open seas and inland rivers with equal ease.',
  'The Inca Empire built an extensive road system spanning over 40,000 kilometers across the rugged terrain of the Andes.',
  'The discovery of penicillin by Alexander Fleming in 1928 revolutionized medicine and saved millions of lives worldwide.',

  // 천문/우주
  'The speed of light in a vacuum is approximately 299,792 kilometers per second, a universal constant in physics.',
  'Jupiter\'s Great Red Spot is a persistent anticyclonic storm that has been observed for more than 350 years.',
  'Neutron stars are so dense that a teaspoon of their material would weigh approximately six billion tons on Earth.',
  'The Andromeda Galaxy is on a collision course with the Milky Way and is expected to merge with it in about 4.5 billion years.',
  'Saturn\'s rings are composed primarily of ice particles, rocky debris, and dust, spanning up to 282,000 kilometers in diameter.',
  'A day on Venus lasts longer than a year on Venus, as the planet rotates extremely slowly on its axis.',
  'The International Space Station orbits Earth at an altitude of roughly 400 kilometers, completing one orbit every 90 minutes.',

  // 인체/의학
  'The human brain contains approximately 86 billion neurons that form complex networks of electrical and chemical signals.',
  'The human body produces about 3.8 million new cells every second, with most of them being blood cells.',
  'Red blood cells travel the entire length of the human circulatory system in approximately 20 seconds.',
  'The human nose can distinguish over one trillion different scent combinations according to recent research.',
  'Bone density typically peaks around age 30 and gradually declines thereafter without regular weight-bearing exercise.',
  'The adult human skeleton is composed of 206 bones, though infants are born with approximately 270 soft bones.',

  // 기술/공학
  'The first transatlantic telegraph cable, completed in 1858, reduced message delivery time from ten days to a few minutes.',
  'Modern fiber-optic cables can carry data at speeds exceeding 100 terabits per second across thousands of kilometers.',
  'The global positioning system relies on a constellation of at least 24 satellites orbiting approximately 20,200 kilometers above Earth.',
  'Three-dimensional printing technology has advanced to the point where it can produce functional human tissue for medical research.',
  'Quantum computers use qubits that can exist in multiple states simultaneously, enabling exponentially faster calculations for certain problems.',
  'The world\'s first programmable electronic computer, Colossus, was built in 1943 to help decipher encrypted enemy communications.',

  // 수학/물리
  'The concept of zero as a number was independently developed by mathematicians in ancient India and Mesoamerica.',
  'Absolute zero, the lowest possible temperature, is exactly minus 273.15 degrees Celsius on the thermodynamic scale.',
  'Pi has been calculated to over 100 trillion digits, yet only 39 digits are needed to calculate the circumference of the observable universe.',
  'The double-slit experiment demonstrates that light and matter can exhibit properties of both waves and particles simultaneously.',

  // 지리/환경
  'The Amazon rainforest produces approximately 20 percent of the world\'s oxygen and houses over 10 million species.',
  'The Sahara Desert, the largest hot desert in the world, covers an area roughly equal to the size of the United States.',
  'Lake Baikal in Siberia contains approximately 20 percent of the world\'s unfrozen surface freshwater.',
  'The global textile industry consumes more water per unit of output than almost any other manufacturing sector.',
  'Deforestation in tropical regions contributes to approximately 10 percent of global greenhouse gas emissions annually.',
  'Iceland generates nearly 100 percent of its electricity from renewable sources, primarily geothermal and hydroelectric power.',

  // 경제/사회
  'The development of ancient trade networks was largely determined by the geography and natural resources of each region.',
  'The global annual production of steel exceeds 1.8 billion tonnes, making it one of the most widely used materials worldwide.',
  'Coffee is the second most traded commodity in the world by volume, surpassed only by crude oil.',
  'The invention of the shipping container in 1956 dramatically reduced the cost of international trade and transformed global commerce.',
  'Roughly one-third of all food produced globally for human consumption is lost or wasted each year along the supply chain.',

  // 언어/문화
  'More than 7,000 languages are currently spoken around the world, though nearly half of them are considered endangered.',
  'The Braille writing system, developed in the 1820s, uses patterns of raised dots to represent letters and numbers for visually impaired readers.',
  'The oldest known musical instruments are flutes carved from bird bones and mammoth ivory, dating back over 40,000 years.',
  'Approximately 50 percent of the world\'s population is bilingual, regularly using two or more languages in daily life.',

  // 식품/농업
  'Chocolate was originally consumed as a bitter beverage by the ancient Maya and Aztec civilizations over 3,000 years ago.',
  'Tomatoes were once widely believed to be poisonous in Europe and were grown only as ornamental plants until the 18th century.',
  'Rice cultivation, which began over 9,000 years ago in the Yangtze River valley, remains the staple food for more than half the world\'s population.',
  'Vanilla is the second most expensive spice in the world after saffron, largely due to the labor-intensive hand-pollination process.',
  'The avocado tree can produce up to 500 avocados per year, though commercial yields vary widely depending on climate and cultivation methods.',

  // 건축/예술
  'The Eiffel Tower was originally intended as a temporary structure for the 1889 World\'s Fair and was nearly dismantled afterward.',
  'Gothic cathedrals used flying buttresses to distribute the weight of their walls, allowing for much larger stained glass windows.',
  'The terracotta army discovered near Xi\'an, China, consists of over 8,000 individually sculpted soldiers buried with the first emperor.',

  // 심리/행동
  'Studies show that the mere presence of a smartphone on a desk, even when turned off, can reduce cognitive capacity during complex tasks.',
  'The human attention span for sustained focus on a single task averages around 20 minutes before performance begins to decline.',
  'Research indicates that people tend to overestimate the likelihood of dramatic events while underestimating common everyday risks.',

  // 교통/인프라
  'The Trans-Siberian Railway stretches over 9,200 kilometers, connecting Moscow to Vladivostok across eight time zones.',
  'The Panama Canal, completed in 1914, reduced the maritime journey between New York and San Francisco by approximately 12,800 kilometers.',
  'High-speed rail networks in Japan achieve average delays of less than one minute per trip, including all natural disaster disruptions.',

  // 에너지
  'Wind turbines can now reach heights exceeding 260 meters, with rotor diameters spanning more than 220 meters across.',
  'Nuclear fusion, which powers the sun, could theoretically provide virtually limitless clean energy if successfully harnessed on Earth.',
  'A single lightning bolt can contain up to one billion volts of electricity and heat the surrounding air to 30,000 degrees Celsius.',
];

/**
 * source 문자열로부터 간단한 해시를 생성하여,
 * 같은 교재 내에서 source(출처번호)마다 다른 시작 오프셋을 부여한다.
 */
function hashSource(source: string): number {
  let h = 0;
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) - h + source.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickIrrelevantTemplate(version: number, source?: string): string {
  const pool = IRRELEVANT_TEMPLATES;
  const offset = source ? hashSource(source) : 0;
  return pool[(offset + Math.abs(version)) % pool.length];
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
