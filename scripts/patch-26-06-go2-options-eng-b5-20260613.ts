/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 5: 30·31·32번 27건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b5-20260613.ts [--apply]
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
  // ── 30번 (Price elasticity of high-tech products)
  {
    id: '6a22222b8d91251beb10f49e', type: '불일치', ca: '②', mustInclude: '전환하는 비용이 낮아 대체품이 많다',
    options: [
      'Innovative high-tech products generally have low price elasticity.',
      'High-tech products have many substitutes because the cost of switching to another product is low.',
      'At the early stage of the technology, buyers are less sensitive to price than to additional performance.',
      'A high-end mobile phone manufacturer targets millionaire households with assets over $2.5 million.',
      'The high price of a product is often perceived as a sign of quality.',
    ],
  },
  {
    id: '6a22222b8d91251beb10f49f', type: '불일치', ca: '③', mustInclude: '가격을 크게 인하하는 데 적극적으로',
    options: [
      'High variation in price, both increases and decreases, does not significantly change demand.',
      'Early-stage buyers often have deep pockets.',
      'Competitors are eager to lower their prices significantly at that stage.',
      'High-tech products have few substitutes.',
      'A high price reinforces a customer’s confidence in the company.',
    ],
  },
  {
    id: '6a22222b8d91251beb10f4a0', type: '불일치', ca: '②', mustInclude: '추가 성능에 더 민감하다',
    options: [
      'Innovative high-tech products generally show low price elasticity.',
      'Early-stage buyers are more sensitive to additional performance than to price.',
      'A high-end mobile phone manufacturer targets 3% of millionaire households.',
      'Millionaire customers are ready to accept the price range the manufacturer has set.',
      'A high price is often perceived as a sign of quality and reinforces customer confidence.',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4b0', type: '일치', ca: '①', mustInclude: '대체품이 많아 전환 비용이 낮다',
    options: [
      'Innovative high-tech products have low price elasticity.',
      'High-tech products have many substitutes, so switching costs are low.',
      'Early-stage technology buyers are more sensitive to price than to additional performance.',
      'A high-end mobile phone manufacturer targets all households.',
      'Competitors try to lower their prices significantly at that stage.',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4b1', type: '일치', ca: '③', mustInclude: '수요가 크게 바뀐다',
    options: [
      'When the price varies greatly, demand changes greatly.',
      'Early-stage technology buyers often lack deep pockets.',
      'A high price is often perceived as a sign of quality.',
      'High-tech products have low costs to switch to another product.',
      'Millionaire households reject the price range set by the manufacturer.',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4b2', type: '일치', ca: '④', mustInclude: '대체품이 많은 편이다',
    options: [
      'High-tech products tend to have many substitutes.',
      'A high price weakens a customer’s confidence in the company.',
      'Innovative high-tech products have high price elasticity.',
      'Competitors are chasing the same categories of customers.',
      'Early-stage buyers are not interested in additional performance.',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4b9', type: '주제', ca: '①', mustInclude: '가격 경쟁이 격화되는',
    options: [
      'why innovative high-tech products have low price elasticity',
      'the process of intensifying price competition in the high-tech market',
      'the background of huge costs invested in developing new technology',
      'methods for analyzing the consumption tendencies of wealthy customers',
      'a strategy to increase market share by adding product substitutes',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4ba', type: '주제', ca: '③', mustInclude: '소비자 심리에 미치는 일반적',
    options: [
      'marketing differentiation strategies by type of high-tech product buyer',
      'the general effect of price changes on consumer psychology',
      'why the price of high-tech products does not respond sensitively to demand',
      'the benefits to consumers of price-cutting competition among rivals',
      'the importance of performance improvement by stage of technological development',
    ],
  },
  {
    id: '6a22222c8d91251beb10f4bb', type: '주제', ca: '④', mustInclude: '가격 인하의 효과',
    options: [
      'the effect of price cuts in increasing demand for high-tech products',
      'the need to develop customized products for millionaire households',
      'the threat that an increase in substitutes poses to the high-tech market',
      'the various factors that make innovative high-tech products insensitive to price changes',
      'the key criteria for deciding the timing of a new product launch',
    ],
  },
  // ── 31번 (Future-proof city)
  {
    id: '6a22222d8d91251beb10f4c2', type: '불일치', ca: '②', mustInclude: '한 번도 바뀌지 않았다',
    options: [
      "The 'future-proof' nature of a city street or square is an easily underappreciated feature.",
      'In the medieval squares of Marrakesh and Siena, the stuff sold has never changed over the last five hundred years.',
      'The same physical store that once sold buggy whips and typewriters might now repair phones.',
      'Jane Jacobs, the great prophet of the city economy, made much of this fact in her books.',
      'Jacobs correctly predicted the persistence of the city itself.',
    ],
  },
  {
    id: '6a22222d8d91251beb10f4c3', type: '불일치', ca: '③', mustInclude: '소멸을 의미할 것이라고 예측한 사람들에 동의',
    options: [
      'The city square is a fairly future-proof technology, like the shopping street, even in the age of online shopping.',
      'The same infrastructure supports evolving uses.',
      'Jane Jacobs agreed with those who predicted that the rise of the Internet would mean the death of the city.',
      'A great advantage of city architecture is its ability to support change in uses.',
      "The Death and Life of Great American Cities is among Jane Jacobs's books.",
    ],
  },
  {
    id: '6a22222d8d91251beb10f4c4', type: '불일치', ca: '④', mustInclude: '소멸할 것이라는 Jacobs의 예측은 정확히',
    options: [
      'The medieval squares in places like Marrakesh and Siena are still places where stuff is sold every day.',
      'A store that once sold buggy whips and typewriters might now repair damaged phones and sell bubble tea.',
      'Jane Jacobs is described as the great prophet of the city economy.',
      "Jacobs's prediction that the rise of the Internet would lead to the death of the city came true exactly.",
      'The same infrastructure supports evolving uses, a fact Jacobs valued in her books.',
    ],
  },
  {
    id: '6a22222d8d91251beb10f4d4', type: '일치', ca: '②', mustInclude: '더 이상 물건이 팔리지 않는다',
    options: [
      'In the medieval squares of Marrakesh and Siena, stuff is no longer sold.',
      'A store that once sold buggy whips and typewriters might now repair phones.',
      'The shopping street has become a technology that cannot be future-proof in the age of online shopping.',
      'Jane Jacobs predicted that the rise of the Internet would mean the death of the city.',
      'The stuff sold in city squares has not changed at all for five hundred years.',
    ],
  },
  {
    id: '6a22222d8d91251beb10f4d5', type: '일치', ca: '①', mustInclude: '단 하나의 고정된 용도만',
    options: [
      'The future-proof nature of a city street or square is an easily underappreciated feature.',
      'The same infrastructure supports only a single fixed use.',
      'Jane Jacobs was a critical skeptic about the city economy.',
      "The Nature of Economies is not one of Jacobs's books.",
      'Medieval squares stopped functioning as places of trade five hundred years ago.',
    ],
  },
  {
    id: '6a22222d8d91251beb10f4d6', type: '일치', ca: '③', mustInclude: '여전히 주로 팔린다',
    options: [
      'City squares can no longer be future-proof in the age of online shopping.',
      'Buggy whips and typewriters are still mainly sold in current physical stores.',
      'Jacobs pointed out that a great advantage of city architecture is its ability to support change in uses.',
      'As many predicted, the rise of the Internet led to the death of the city.',
      'Jacobs was one of those who predicted the city would soon disappear.',
    ],
  },
  {
    id: '6a22222e8d91251beb10f4dd', type: '주제', ca: '①', mustInclude: '부정적 영향',
    options: [
      'the future adaptability of urban space that accommodates changing uses',
      'the negative impact of online shopping on traditional shopping districts',
      'the need for urban planning to preserve medieval squares',
      'the causes of disagreement among scholars in predicting the city economy',
      'innovations that Internet technology brought to urban architectural styles',
    ],
  },
  {
    id: '6a22222e8d91251beb10f4de', type: '주제', ca: '③', mustInclude: '사라질 위기에 처한 오프라인',
    options: [
      'the historical change in the kinds of goods handled by city stores',
      'the limits of offline stores at risk of disappearing in the digital age',
      'the persistence of the same urban infrastructure enduring changing uses',
      'the architectural artistry of famous medieval squares around the world',
      'the various methodologies urban economists use to predict the future',
    ],
  },
  {
    id: '6a22222e8d91251beb10f4df', type: '주제', ca: '④', mustInclude: '예측의 정확성',
    options: [
      'the accuracy of the prediction that the rise of the Internet would cause the death of the city',
      'the background of new businesses such as bubble tea and phone repair',
      'the change in goods traded in squares from medieval times to the present',
      'the future-oriented adaptability of urban space that accommodates changing uses',
      "the limits of Jane Jacobs's academic legacy in urban economics",
    ],
  },
  // ── 32번 (Touch and plant growth)
  {
    id: '6a22222e8d91251beb10f4e6', type: '불일치', ca: '③', mustInclude: '성장을 오히려 촉진한다',
    options: [
      'The genomics revolution made it possible to see the impact of touch on plants at a deeper level.',
      'Arabidopsis thaliana is a weedy plant in the mustard family, called the lab rat of the plant biology world.',
      'Researchers found that touch actually promotes the growth of plants.',
      "Researchers analyzed the genetic responses after stroking arabidopsis with soft paintbrushes.",
      "Within 30 minutes of being touched, 10 percent of the plant's genome was altered.",
    ],
  },
  {
    id: '6a22222e8d91251beb10f4e7', type: '불일치', ca: '②', mustInclude: '절반 이상이 변형되었다',
    options: [
      "Touch can trigger a dramatic response in a plant's hormones and gene expression.",
      "Within 30 minutes of being touched, more than half of the plant's genome was altered.",
      'The plant was reorganizing its priorities to deal with the disturbance.',
      'The plant was rerouting energy away from the hard work of getting taller.',
      'When touched multiple times, arabidopsis cut its upward growth rate by as much as 30 percent.',
    ],
  },
  {
    id: '6a22222e8d91251beb10f4e8', type: '불일치', ca: '④', mustInclude: '성장률을 오히려 30퍼센트까지 늘렸다',
    options: [
      'Arabidopsis thaliana is a weed in the mustard family.',
      'Touch was found to be able to substantially inhibit plant growth.',
      "Researchers analyzed the plants' genetic responses after stroking them.",
      'When touched multiple times, arabidopsis instead increased its growth rate by up to 30 percent.',
      'Touch quietly triggered a dramatic response in hormones and gene expression.',
    ],
  },
  {
    id: '6a22222f8d91251beb10f4f8', type: '일치', ca: '①', mustInclude: '콩과에 속하는',
    options: [
      'The genomics revolution made it possible to see the impact of touch on plants at a deeper level.',
      'Arabidopsis thaliana is a plant in the legume family.',
      'Researchers tapped arabidopsis with a hard stick.',
      "Within 30 minutes of being touched, 30 percent of the plant's genome was altered.",
      'Touch was shown to promote the growth of plants.',
    ],
  },
  {
    id: '6a22222f8d91251beb10f4f9', type: '일치', ca: '②', mustInclude: '변화를 전혀 발견하지 못했다',
    options: [
      'Researchers found no change at all in the hormones or gene expression of arabidopsis.',
      "Touch triggered a dramatic response in a plant's hormones and gene expression.",
      'Arabidopsis is a plant rarely studied in the plant biology world.',
      'Touched plants concentrated more energy on the work of getting taller.',
      'Researchers observed only the appearance of arabidopsis without analyzing its genetic responses.',
    ],
  },
  {
    id: '6a22222f8d91251beb10f4fa', type: '일치', ca: '③', mustInclude: '성장률을 떨어뜨리지 않았다',
    options: [
      'Arabidopsis touched multiple times did not lower its upward growth rate.',
      'The response to touch began to appear only after several days had passed.',
      'When touched multiple times, arabidopsis cut its upward growth rate by as much as 30 percent.',
      'The plant kept its priorities unchanged to deal with the disturbance.',
      "Touch caused no change in the plant's genes.",
    ],
  },
  {
    id: '6a22222f8d91251beb10f501', type: '주제', ca: '②', mustInclude: '호르몬의 다양한 종류',
    options: [
      'the various types of hormones that regulate gene expression in plants',
      'how touch triggers a genetic response in plants and inhibits their growth',
      'how the genomics revolution contributed to crop variety improvement',
      'the background of how arabidopsis became the standard organism for plant experiments',
      'plants’ rapid physical defense mechanism against external stimuli',
    ],
  },
  {
    id: '6a2222308d91251beb10f502', type: '주제', ca: '③', mustInclude: '윤리적 문제점',
    options: [
      'the ethical problems of plant experiments using paintbrushes',
      'the principle by which plants change priorities according to soil environment',
      'how touch stimulation impairs plant growth through genetic change',
      'the effect of plant hormones on weed reproduction',
      'the medical achievements brought by advances in genome analysis technology',
    ],
  },
  {
    id: '6a2222308d91251beb10f503', type: '주제', ca: '④', mustInclude: '굴광성의 유전적 기초',
    options: [
      'the genetic basis of phototropism, by which plants grow toward light',
      'how to use touch stimulation to speed up plant growth',
      'the ecological traits and taxonomic value of mustard-family plants',
      'the genetic change in plants in response to touch and its growth-inhibiting effect',
      'a comparison of stimulus-response mechanisms in plants and animals',
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
