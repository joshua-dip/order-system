/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 8(최종): 39·40·41~42·43~45번 36건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b8-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];

const FIXES: { id: string; type: string; ca: string; mustInclude: string; options: string[] }[] = [
  // ── 39번 (Purpose-washing)
  {
    id: '6a22223a8d91251beb10f5e2', type: '불일치', ca: '④', mustInclude: '차별화의 이점을 영구적으로 유지한다',
    options: [
      'Some brands broadcast their social purpose before they actually do much good.',
      'Some marketers use social purpose to boost brand reputation rather than embracing the purpose itself.',
      'Making a real difference in social problems must follow from an authentic, company-wide commitment.',
      'Purpose-washing brands keep the benefit of differentiation permanently.',
      'Purpose-washing brands may make employees feel worse about working for the company.',
    ],
  },
  {
    id: '6a22223a8d91251beb10f5e3', type: '불일치', ca: '③', mustInclude: '진정한 헌신 없이도 사회 문제에 실제적 차이를 손쉽게',
    options: [
      'Some brands that recognize the benefit of differentiation broadcast their social purpose in advance.',
      'Purpose-washing is similar to green-washing, where purpose-driven activities mainly serve publicity.',
      'Social purpose easily makes a real difference in social problems even without authentic commitment.',
      'Purpose-washing brands lose out on positioning for future markets.',
      'Anand Giridhardas describes social purpose that furthers the charade of elites who give little back.',
    ],
  },
  {
    id: '6a22223a8d91251beb10f5e4', type: '불일치', ca: '④', mustInclude: '직원들의 만족도를 오히려 높여 준다',
    options: [
      'Marketers use social purpose to boost brand reputation rather than embracing the purpose itself.',
      'Without authentic commitment, the mission is just window-dressing.',
      'Purpose-washing brands gain the benefit of differentiation only for a short while.',
      'Purpose-washing brands actually raise employee satisfaction.',
      'Some brands broadcast their social purpose before doing enough actual good.',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5f4', type: '일치', ca: '①', mustInclude: '사회적 목적 자체를 받아들이는 데 집중',
    options: [
      'Some brands broadcast their social purpose before they actually do much good.',
      'Marketers focus on embracing social purpose itself rather than on the brand’s reputation.',
      'Making a real difference in social problems is a relatively easy task.',
      'Purpose-washing brands enjoy the benefit of differentiation for a long time.',
      'Purpose-washing makes employees feel better about their company.',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5f5', type: '일치', ca: '②', mustInclude: '진정한 헌신 없이도 쉽게 성공',
    options: [
      'Social purpose can succeed easily even without authentic commitment.',
      'To succeed, social purpose must follow from an authentic, company-wide commitment.',
      'Purpose-washing is the exact opposite concept of green-washing.',
      'Purpose-washing brands gain a permanent advantage of differentiation.',
      'Marketers always embrace the purpose itself rather than the brand’s reputation.',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5f6', type: '일치', ca: '③', mustInclude: '주로 환경 보호의 역할',
    options: [
      'In green-washing, purpose-driven activities serve mainly to protect the environment.',
      'Marketers give up reputation in order to embrace social purpose itself.',
      'Purpose-washing brands gain the benefit of differentiation only for a short while.',
      'Broadcasting a social purpose brings no benefit of differentiation at all.',
      'Anand Giridhardas describes elites who give much back to society.',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5fd', type: '주제', ca: '①', mustInclude: '브랜드 차별화 전략의 다양성',
    options: [
      'the limits and side effects of promoting social purpose without authenticity',
      'the diversity of brand differentiation strategies through social purpose',
      'the structural causes of companies’ failure to solve social problems',
      'the historical background of consumers’ preference for ethical brands',
      'the direct effect of employee satisfaction on a company’s reputation',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5fe', type: '주제', ca: '③', mustInclude: '법적 규제 필요성',
    options: [
      'how social-purpose marketing contributes to increasing sales',
      'the need for legal regulation of green-washing and purpose-washing',
      'the danger of social purpose reduced to a mere publicity tool',
      'the process by which elites change the social order',
      'the expanding role of marketers in managing brand reputation',
    ],
  },
  {
    id: '6a22223b8d91251beb10f5ff', type: '주제', ca: '③', mustInclude: '회사 전체의 협력 체계',
    options: [
      'the intensifying competition among companies in social contribution for differentiation',
      'the company-wide cooperation system needed to solve social problems',
      'the negative results of pursuing social purpose without authentic commitment',
      'brand transparency strategies for restoring consumer trust',
      'the fundamental conflict between social purpose and corporate profit',
    ],
  },
  // ── 40번 (Music and violation of expectations)
  {
    id: '6a22223c8d91251beb10f606', type: '불일치', ca: '⑤', mustInclude: '오직 음높이 영역에서만',
    options: [
      'The brain needs to create a schema of a constant pulse to know when musicians are not conforming to it.',
      'To perceive a variation of a melody, one must have a mental representation of that melody.',
      'Knowing what the pulse is and when it occurs is a crucial part of musical emotion.',
      'Music communicates to us emotionally through systematic violations of expectations.',
      'Violations of expectations can occur only in the domain of pitch.',
    ],
  },
  {
    id: '6a22223c8d91251beb10f607', type: '불일치', ca: '③', mustInclude: '어떠한 예상치 못한 요소도 포함해서는 안 된다',
    options: [
      'Creating a schema of a constant pulse is similar to dealing with variations of a melody.',
      'Violations can occur in any domain, but occur they must.',
      'Music is organized sound and must not include any unexpected element.',
      'If the organization lacks unexpected elements, music becomes emotionally flat and robotic.',
      'Too much organization may technically be music, but music no one wants to listen to.',
    ],
  },
  {
    id: '6a22223c8d91251beb10f608', type: '불일치', ca: '②', mustInclude: '음악적 감정과 무관한 부수적 요소',
    options: [
      'The brain creates a schema of the pulse to know when a musician is not conforming to it.',
      'Metrical extraction is merely an incidental element unrelated to musical emotion.',
      'Music communicates to us emotionally through systematic violations of expectations.',
      'Violations can occur in domains such as pitch, rhythm, and tempo, but occur they must.',
      'Music with too much organization would be music no one wants to listen to.',
    ],
  },
  {
    id: '6a22223c8d91251beb10f618', type: '일치', ca: '①', mustInclude: '정신적 표상이 필요하지 않다',
    options: [
      'The brain needs to create a schema of a constant pulse to know when a musician is not conforming to it.',
      'Perceiving a variation of a melody does not require a mental representation.',
      'Metrical extraction is an incidental element unrelated to musical emotion.',
      'Music communicates emotionally by faithfully following expectations.',
      'Music with too much organization cannot technically be called music.',
    ],
  },
  {
    id: '6a22223d8d91251beb10f619', type: '일치', ca: '①', mustInclude: '음높이 영역에서만 발생',
    options: [
      'Music communicates to us emotionally through systematic violations of expectations.',
      'Violations of expectations can occur only in the domain of pitch.',
      'Metrical extraction means the process of forgetting what the melody is.',
      'Music with no unexpected element at all is the most emotionally rich.',
      'In music, violation is an optional element that may or may not occur.',
    ],
  },
  {
    id: '6a22223d8d91251beb10f61a', type: '일치', ca: '①', mustInclude: '예상치 못한 약간의 요소를 포함해야',
    options: [
      'The organization of music has to involve some element of the unexpected.',
      'Having a schema of a constant pulse interferes with appreciating music.',
      'Music with too much organization is music everyone wants to listen to.',
      'Metrical extraction has nothing to do with expecting when the pulse occurs.',
      'If a musician alters the melody freely, listeners can never perceive it.',
    ],
  },
  {
    id: '6a22223d8d91251beb10f621', type: '주제', ca: '①', mustInclude: '박자를 정확히 지켜야 하는',
    options: [
      'the property of music that conveys emotion through violations of expectations',
      'the performance reasons why musicians must keep the beat precisely',
      'training methods to build composing skills through melodic variation',
      'the development of acoustic technology that measures pitch and rhythm',
      'how audiences’ musical tastes change over time',
    ],
  },
  {
    id: '6a22223d8d91251beb10f622', type: '주제', ca: '③', mustInclude: '완벽한 규칙성이 음악적 완성도를',
    options: [
      'the need to build a sense of beat in music education',
      'why perfect regularity raises musical perfection',
      'the principle by which violations of expectation evoke musical emotion',
      'the physical process by which various instruments create timbre',
      'the neurological mechanism by which the brain distinguishes noise from music',
    ],
  },
  {
    id: '6a22223d8d91251beb10f623', type: '주제', ca: '⑤', mustInclude: '음악 장르마다 다른 박자 구조',
    options: [
      'the features of beat structures that differ by music genre',
      'the difficulty composers face in predicting audiences’ expectations',
      'the artistic limits of a performer’s improvisation',
      'the importance of absolute pitch in appreciating music',
      'the musical emotion created by the interaction of expectation and its violation',
    ],
  },
  // ── 41~42번 (Oil and fuel cell technology)
  {
    id: '6a22223d8d91251beb10f62a', type: '불일치', ca: '④', mustInclude: '아직 시제품 모터를 생산하지 못했다',
    options: [
      'The major consumer of oil is transport.',
      'Car engines today are far more efficient in fuel consumption than those of 1972.',
      'Fuel cell technology produces energy from water.',
      'The big car multinationals have not yet produced prototype motors.',
      "The 'oil majors' have diversified and are now more energy companies than oil companies.",
    ],
  },
  {
    id: '6a22223d8d91251beb10f62b', type: '불일치', ca: '③', mustInclude: '석유 가격은 급등할 것이다',
    options: [
      'Car engines today are far less polluting than those of 1972.',
      'The cars Asia buys tomorrow will be nothing like those Americans use today.',
      'If there is a breakthrough in fuel cell technology, oil prices will soar.',
      'The big car multinationals are currently racing to get prices down and engine performance up.',
      'OPEC countries are urgently attempting to develop other industries.',
    ],
  },
  {
    id: '6a22223d8d91251beb10f62c', type: '불일치', ca: '④', mustInclude: '막대한 수입을 얻게 될 것이다',
    options: [
      'Car engines have become more efficient because oil is expensive.',
      'Americans will not buy today’s cars tomorrow either.',
      'If the price of oil rises further, fuel cell technology will receive yet another momentum.',
      'If fuel cell technology makes oil prices fall dramatically, OPEC oil producers will gain huge income.',
      'The fact that this threat is real is driving producers to look for alternative sources of income.',
    ],
  },
  {
    id: '6a22223e8d91251beb10f63c', type: '일치', ca: '①', mustInclude: '효율이 떨어진다',
    options: [
      'The major consumer of oil is the transport sector.',
      'Car engines today are less efficient in fuel consumption than in 1972.',
      'Fuel cell technology produces energy from air.',
      'The big car multinationals have not yet produced prototype motors.',
      "The 'oil majors' refuse to diversify and focus only on the oil business.",
    ],
  },
  {
    id: '6a22223e8d91251beb10f63d', type: '일치', ca: '③', mustInclude: '똑같은 자동차를 계속 구매',
    options: [
      'Americans will keep buying the same cars tomorrow as today.',
      'If there is a breakthrough in fuel cell technology, oil prices will soar.',
      'Car engines today cause far less pollution than in the past.',
      'OPEC countries have no interest in developing other industries.',
      'Car multinationals are focusing on lowering engine performance.',
    ],
  },
  {
    id: '6a22223e8d91251beb10f63e', type: '일치', ca: '②', mustInclude: '거의 같을 것이다',
    options: [
      'The cars Asia buys tomorrow will be almost the same as those Americans use today.',
      'If oil prices fall dramatically, oil companies and OPEC producers will lose much income.',
      'The future profits of car multinationals depend on rising oil prices.',
      'Car engine efficiency has risen because oil is cheap.',
      'The threat of fuel cell technology is merely an imaginary concern.',
    ],
  },
  {
    id: '6a22223f8d91251beb10f645', type: '주제', ca: '①', mustInclude: '내연기관의 작동 원리',
    options: [
      'the technological change driven by high oil prices and the oil industry’s response',
      'how the internal combustion engine works and advances in fuel-efficiency measurement',
      'the rapid growth of the Asian car market and the decline of the U.S. market',
      'the environmental benefits of clean energy that uses water',
      'conflict among OPEC producers over adjusting output',
    ],
  },
  {
    id: '6a22223f8d91251beb10f646', type: '주제', ca: '③', mustInclude: '완전히 대체하는 과정',
    options: [
      'the process of fuel cell cars completely replacing conventional combustion cars',
      'the source of the huge future profits enjoyed by car multinationals',
      'technological advances that threaten oil demand and oil producers’ search for survival strategies',
      'the trend of stricter car-emission regulations since 1972',
      'the change in the share of transport in total oil consumption',
    ],
  },
  {
    id: '6a22223f8d91251beb10f647', type: '주제', ca: '④', mustInclude: '화석 연료 고갈',
    options: [
      'the negative effect of fossil fuel depletion on the world economy',
      'the causes of differences in car-consumption tendencies between the U.S. and Asia',
      'the technical limits that block the commercialization of fuel cell technology',
      'engine innovation driven by expensive oil and the transformation of the oil industry',
      'cases of technological cooperation between car multinationals and oil-producing nations',
    ],
  },
  // ── 43~45번 (Anna and Mrs. Pike)
  {
    id: '6a22223f8d91251beb10f64e', type: '불일치', ca: '④', mustInclude: '정원에 식물을 계속 심었다',
    options: [
      'Anna wrote about her balcony garden and included drawings of flowers in her letter.',
      'Anna forgot about the letter until a package arrived a month later.',
      'Inside the package were a folded letter and a jar of homemade strawberry mint jam.',
      'Mrs. Pike kept planting in her garden even after her husband died.',
      'Anna used the empty jam jar to plant some rosemary.',
    ],
  },
  {
    id: '6a22223f8d91251beb10f64f', type: '불일치', ca: '⑤', mustInclude: '더 이상 편지를 쓰지 않았다',
    options: [
      'Orange High School students wrote letters to elders as part of a kindness project.',
      'Anna mentioned that she enjoyed taking care of plants despite limited space.',
      'When the class arrived at the village, Mrs. Pike warmly greeted Anna with open arms.',
      'Mrs. Pike gave Anna some herbs to take home.',
      'After the visit, Anna no longer wrote to Mrs. Pike.',
    ],
  },
  {
    id: '6a22223f8d91251beb10f650', type: '불일치', ca: '⑤', mustInclude: '슬픈 감정을 느꼈다',
    options: [
      'Anna was thrilled when the teacher announced the plan to visit the village.',
      'Mrs. Pike pointed to the green space beside her house and told Anna to look at her herbs.',
      'Anna and Mrs. Pike spent the day planting seeds together.',
      'Anna started a gardening club where students planted seeds in recycled jars and cups.',
      'Whenever Anna looked at the rosemary grown by the window, she felt sad.',
    ],
  },
  {
    id: '6a2222408d91251beb10f660', type: '일치', ca: '①', mustInclude: '공간이 넓어서',
    options: [
      'Anna wrote about her balcony garden and included drawings of flowers in her letter.',
      'Anna mentioned that she enjoyed taking care of plants because she had plenty of space.',
      'Anna received the package right after she sent her letter.',
      'The package from Mrs. Pike contained a jar of apple jam.',
      'Mrs. Pike kept gardening even after her husband died.',
    ],
  },
  {
    id: '6a2222408d91251beb10f661', type: '일치', ca: '②', mustInclude: '끝내 학생들에게 알리지 않았다',
    options: [
      'The teacher never told the students about the plan to visit the village.',
      'Mrs. Pike pointed to the green space beside her house and showed Anna her herbs.',
      'When Anna visited the village, she said the herbs did not smell good.',
      'Anna and Mrs. Pike planted flowering trees together on the day of the visit.',
      'Mrs. Pike did not give Anna any herbs to take home.',
    ],
  },
  {
    id: '6a2222408d91251beb10f662', type: '일치', ca: '③', mustInclude: '더 이상 편지를 쓰지 않았다',
    options: [
      'After the visit, Anna no longer wrote to Mrs. Pike.',
      'In the club Anna started, members bought new pots and planted seeds.',
      'Anna used the empty jam jar to plant some rosemary.',
      'The rosemary grew in front of Anna’s door.',
      'Whenever Anna looked at the rosemary, she felt sad.',
    ],
  },
  {
    id: '6a2222408d91251beb10f669', type: '주제', ca: '①', mustInclude: '봉사 제도의 필요성',
    options: [
      'how a small act of kindness brought a warm change to someone’s heart',
      'the need for community service systems to care for the elderly',
      'various ways to efficiently tend a balcony garden',
      'differences in lifestyle between city and countryside and how to overcome them',
      'the effect of growing plants on the academic achievement of teenagers',
    ],
  },
  {
    id: '6a2222408d91251beb10f66a', type: '주제', ca: '②', mustInclude: '친환경 정원 가꾸기 운동',
    options: [
      'an eco-friendly gardening movement using recycled containers',
      'the comfort that a sincere exchange begun through letters gave to each other’s lives',
      'the seriousness of the emotional isolation of an elder who lost a spouse',
      'setting effective evaluation criteria for school volunteer activities',
      'suitable environments and care tips for growing herbs',
    ],
  },
  {
    id: '6a2222408d91251beb10f66b', type: '주제', ca: '④', mustInclude: '인구 감소 문제',
    options: [
      'the population decline of rural villages and ways to solve it',
      'effective letter-writing methods using drawings and text',
      'how youth club activities help with career choices',
      'the virtuous cycle in which warm care spreads from person to person',
      'the growth characteristics of various plants with seasonal change',
    ],
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();
  const report: Record<string, unknown>[] = [];

  for (const f of FIXES) {
    const doc = await col.findOne({ _id: new ObjectId(f.id) });
    const qd = (doc?.question_data ?? {}) as Record<string, unknown>;
    const curOptions = String(qd.Options ?? '');
    const curCa = String(qd.CorrectAnswer ?? '').trim();
    if (!doc || doc.type !== f.type || curCa !== f.ca || !curOptions.includes(f.mustInclude)) {
      report.push({ id: f.id, error: `사전 조건 불일치 (type=${doc?.type}, CA=${curCa}) — 건너뜀` });
      continue;
    }
    const newOptions = f.options.map((o, i) => `${CIRCLED[i]} ${o}`).join(' ### ');
    report.push({ id: f.id, source: doc.source, type: f.type, action: APPLY ? '교체' : '교체 예정' });
    if (APPLY) {
      await col.updateOne(
        { _id: doc._id },
        { $set: { 'question_data.Options': newOptions, updated_at: now } },
      );
    }
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, report }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
