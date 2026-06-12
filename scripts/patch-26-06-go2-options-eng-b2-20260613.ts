/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 2: 21·22·23번 27건 (2026-06-13).
 * 원문 대조로 참/거짓 의미 보존, 정답 슬롯·한글 해설 유지.
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b2-20260613.ts [--apply]
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
  // ── 21번 (Visual imagery)
  {
    id: '6a2222188d91251beb10f35a', type: '불일치', ca: '③', mustInclude: '서로 다른 뇌 영역이 사용됨',
    options: [
      'Humans excel at visual imagery.',
      "The brain's visual imagery ability allows us to rehearse actions without the risks of doing them in the real world.",
      "Steve Kosslyn's studies show that different brain regions are used for imagining a scene and actually viewing one.",
      'Evolution has made internally generated representations never as authentic as the real thing.',
      'If internal models were as authentic as reality, people could lose the incentive to find food.',
    ],
  },
  {
    id: '6a2222188d91251beb10f35b', type: '불일치', ca: '②', mustInclude: '실제만큼 진짜인 것은 유전자 편에서 지혜로운',
    options: [
      'Our brains evolved the ability to create internal models in which we can rehearse forthcoming actions.',
      "It is a wise bit of self-restraint on our genes' part that internal representations are as authentic as the real thing.",
      'If the internal model were a perfect substitute, you could simply imagine consuming a feast whenever you felt hungry.',
      'If the internal model were a perfect substitute, you would have no incentive to find real food and would starve.',
      'The Bard said you cannot satisfy hunger by bare imagination of a feast.',
    ],
  },
  {
    id: '6a2222188d91251beb10f35c', type: '불일치', ca: '④', mustInclude: '항상 실제보다 더 진짜이도록',
    options: [
      'The brain creates internal models to rehearse actions without real-world risks or penalties.',
      'Steve Kosslyn is a psychologist at Harvard University.',
      'There are hints that the brain uses the same regions to imagine a scene as when actually viewing one.',
      'Evolution has made internally generated representations always more authentic than the real thing.',
      'If the internal model were a perfect substitute, one would soon starve to death.',
    ],
  },
  {
    id: '6a2222198d91251beb10f36c', type: '일치', ca: '①', mustInclude: '진화와 무관함을 밝혔다',
    options: [
      'The ability of visual imagery evolved to rehearse forthcoming actions.',
      'The brain uses different regions for imagining a scene and actually viewing one.',
      'Internally generated representations can be as authentic as the real thing.',
      'Having a perfect internal model strengthens the motivation to find real food.',
      "Kosslyn's research revealed that visual imagery has nothing to do with evolution.",
    ],
  },
  {
    id: '6a2222198d91251beb10f36d', type: '일치', ca: '②', mustInclude: '다른 동물보다 떨어진다',
    options: [
      'Humans are worse at visual imagery than other animals.',
      'The brain uses the same regions to imagine a scene as when actually viewing one.',
      'Evolution has made internal representations more vivid than the real thing.',
      'If the internal model were a perfect substitute, humans would survive longer.',
      "The self-restraint is a foolish decision on the genes' part.",
    ],
  },
  {
    id: '6a2222198d91251beb10f36e', type: '일치', ca: '④', mustInclude: 'Harvard 대학교의 생물학자',
    options: [
      'Visual imagery is a skill humans learn after birth.',
      'Kosslyn is a biologist at Harvard University.',
      "Internal representations being as authentic as reality is thanks to the genes' restraint.",
      'If the internal model were a perfect substitute, you could simply imagine consuming a feast whenever you felt hungry.',
      'Humans can fully satisfy their hunger by imagination alone.',
    ],
  },
  {
    id: '6a2222198d91251beb10f375', type: '주제', ca: '①', mustInclude: '상상력 발달에 기여한 과정',
    options: [
      'why mental imagery evolved to be never as vivid as real experience',
      'how brain-imaging studies have contributed to the development of imagination',
      'the limits of visual imagery in the struggle for survival',
      'how mental rehearsal reduces the risks of real actions',
      'the mechanism by which hunger stimulates human imagination',
    ],
  },
  {
    id: '6a2222198d91251beb10f376', type: '주제', ca: '②', mustInclude: '의사 결정 능력을 향상',
    options: [
      'why the human brain uses the same regions for imagination and actual perception',
      'the adaptive significance of imagination evolving not to fully substitute for reality',
      'how mental models improve human decision-making',
      'various cognitive abilities that evolution has given humans',
      'the decisive influence of hunger on human survival instincts',
    ],
  },
  {
    id: '6a2222198d91251beb10f377', type: '주제', ca: '③', mustInclude: '예술과 문학 창작에 끼친',
    options: [
      'the need for learning strategies that use visual imagination',
      'the influence of human imagination on art and literature',
      'the wisdom of evolution in keeping mental imagery from surpassing real experience',
      'innovative changes that brain-imaging technology brought to psychology',
      'the danger of virtual experiences replacing real actions',
    ],
  },
  // ── 22번 (Probability weighting)
  {
    id: '6a22221a8d91251beb10f37e', type: '불일치', ca: '③', mustInclude: '더 작게 의사결정에 반영',
    options: [
      'We want to know the subjective probability weight for each objective probability.',
      'Low-probability events can be defined as probabilities up to about 25 percent.',
      'Low-probability events tend to factor less into decisions than they should.',
      'The smaller the probability, the more we overestimate its likelihood.',
      'People who play the lottery are often optimistic about winning.',
    ],
  },
  {
    id: '6a22221a8d91251beb10f37f', type: '불일치', ca: '④', mustInclude: '확률이 더 클수록 우리는',
    options: [
      "Events that could happen but aren't likely are low-probability events.",
      'An event with an objective one-percent chance could subjectively seem to have a five-percent chance.',
      'We overestimate the likelihood of low-probability events.',
      'The larger the probability, the more we overestimate its likelihood.',
      'The odds of a single ticket winning the largest U.S. lotteries are about one in 175 million.',
    ],
  },
  {
    id: '6a22221a8d91251beb10f380', type: '불일치', ca: '③', mustInclude: '0.5퍼센트처럼',
    options: [
      'Objective probabilities range from one percent to 100 percent.',
      'Low-probability events can be defined as probabilities up to about 25 percent.',
      'An event with an objective one-percent chance could subjectively seem to have a 0.5-percent chance.',
      'We tend to overestimate the likelihood of low-probability events.',
      'People who play the lottery are often optimistic about winning.',
    ],
  },
  {
    id: '6a22221b8d91251beb10f390', type: '일치', ca: '①', mustInclude: '대체로 비관적이다',
    options: [
      'Low-probability events can be defined as probabilities up to about 25 percent.',
      'We underestimate the likelihood of low-probability events.',
      'The larger the probability, the more we overestimate its likelihood.',
      'Low-probability events factor less into decisions than they should.',
      'People who play the lottery are generally pessimistic about winning.',
    ],
  },
  {
    id: '6a22221b8d91251beb10f391', type: '일치', ca: '②', mustInclude: '정확히 1퍼센트로 취급',
    options: [
      'An objective one-percent chance is treated subjectively as exactly one percent.',
      'An event with an objective one-percent chance could subjectively seem to have a five-percent chance.',
      'Low-probability events are hardly factored into decisions.',
      'We have no interest in subjective probability weights.',
      'The odds of winning the most popular U.S. lotteries are relatively high.',
    ],
  },
  {
    id: '6a22221b8d91251beb10f392', type: '일치', ca: '①', mustInclude: '약 1만 분의 1',
    options: [
      'We want to know the subjective probability weight for each objective probability.',
      'Low-probability events are defined as events that cannot happen.',
      'The larger the probability, the more we overestimate its likelihood.',
      'Lottery players judge their chances of winning realistically.',
      'The odds of a single lottery ticket winning are about one in 10,000.',
    ],
  },
  {
    id: '6a22221b8d91251beb10f399', type: '주제', ca: '①', mustInclude: '통계적 방법',
    options: [
      'the tendency to overestimate low-probability events in decision-making',
      'statistical methods for calculating objective probabilities accurately',
      'effective strategies for improving the odds of winning the lottery',
      'positive effects of risk aversion on rational consumption',
      'how subjective feelings make probability calculations accurate',
    ],
  },
  {
    id: '6a22221b8d91251beb10f39a', type: '주제', ca: '③', mustInclude: '도박 중독을 예방',
    options: [
      'how the lottery industry contributes to economic growth',
      'rational judgment through matching objective and subjective probabilities',
      'the human tendency to weigh smaller probabilities more heavily than they deserve',
      'the effect of probability education on preventing gambling addiction',
      'decision-making errors of underestimating high-probability events',
    ],
  },
  {
    id: '6a22221b8d91251beb10f39b', type: '주제', ca: '④', mustInclude: '수학적 모델의 발전',
    options: [
      'the development of mathematical models for measuring probability weights',
      'common behavioral traits of lottery winners',
      'the importance of events with probabilities over 25 percent in decisions',
      "people's tendency to take small-probability events as larger than they really are",
      'the benefits of optimism for rational risk management',
    ],
  },
  // ── 23번 (Common currency)
  {
    id: '6a22221b8d91251beb10f3a2', type: '불일치', ca: '④', mustInclude: '더 적게 성장한다',
    options: [
      'Many of the barriers to trade do not exist because of a lack of markets or customers.',
      'Transaction costs include not only straight exchange costs but also the costs of converting and paying funds.',
      "With a common currency, the savings can be reinvested into firms' productivity and innovation.",
      'By unifying currencies, whole economies grow less than they would as independents.',
      'A common currency provides a strong economic foundation that all can benefit from.',
    ],
  },
  {
    id: '6a22221c8d91251beb10f3a3', type: '불일치', ca: '③', mustInclude: '더욱 증가한다',
    options: [
      'Barriers to trade exist because there are major barriers to getting products to market at competitive prices.',
      'Transaction costs are significant for companies.',
      'Having a common currency makes many transaction costs increase even more.',
      'Useless costs turn into productive costs.',
      'This turning of costs brings longer-term benefits to the whole economy.',
    ],
  },
  {
    id: '6a22221c8d91251beb10f3a4', type: '불일치', ca: '⑤', mustInclude: '일부 소수의 기업만',
    options: [
      'The barriers to trade do not exist because of a lack of markets or customers.',
      'Transaction costs include the cost of hedging funds.',
      "The savings from a common currency can be reinvested into firms' productivity and innovation.",
      'By unifying currencies, whole economies benefit and grow.',
      'A common currency provides an economic foundation that only a few companies can benefit from.',
    ],
  },
  {
    id: '6a22221c8d91251beb10f3b4', type: '일치', ca: '③', mustInclude: '단기적인 손실만',
    options: [
      'Many barriers to trade exist because of a lack of markets or customers.',
      'Transaction costs include only straight exchange costs, excluding the cost of converting funds.',
      "With a common currency, many transaction costs disappear and the savings can be reinvested into firms' productivity and innovation.",
      'Useless costs bring only short-term losses.',
      'Economies that unify their currencies grow less than they would as independents.',
    ],
  },
  {
    id: '6a22221c8d91251beb10f3b5', type: '일치', ca: '①', mustInclude: '미미한 수준에 그친다',
    options: [
      'Trade barriers exist because there are major barriers to getting products to market at competitive prices.',
      'Transaction costs are negligible for companies.',
      "A common currency actually lowers firms' productivity.",
      'Unifying currencies makes only some economies suffer losses.',
      'A common currency provides a foundation that benefits only a powerful few.',
    ],
  },
  {
    id: '6a22221c8d91251beb10f3b6', type: '일치', ca: '②', mustInclude: '다시 투자되지 못하고 사라진다',
    options: [
      'Barriers to trade arise mainly from a lack of markets and customers.',
      'Transaction costs include the costs of converting, paying, and hedging funds.',
      'The saved transaction costs disappear without being reinvested.',
      'Useless costs remain unproductive to the end.',
      'A common currency weakens the foundation of the whole economy.',
    ],
  },
  {
    id: '6a22221d8d91251beb10f3bd', type: '주제', ca: '①', mustInclude: '정책적 노력',
    options: [
      'the benefits a common currency brings to the economy by cutting transaction costs',
      "governments' policy efforts to lower trade barriers",
      'negative effects of exchange rate fluctuations on export competitiveness',
      'the key role of securing markets and customers in trade growth',
      'the need for effective investment strategies to promote corporate innovation',
    ],
  },
  {
    id: '6a22221d8d91251beb10f3be', type: '주제', ca: '③', mustInclude: '국가 주권 보호',
    options: [
      'the complex steps of currency exchange that increase transaction costs',
      'customer complaints companies face when selling at competitive prices',
      'how unifying currencies reduces transaction costs and drives economic growth',
      'how independent currency systems help protect national sovereignty',
      'the imbalance of markets and customer demand that creates trade barriers',
    ],
  },
  {
    id: '6a22221d8d91251beb10f3bf', type: '주제', ca: '④', mustInclude: '마케팅 전략',
    options: [
      'how hedging reduces the risks of managing corporate funds',
      'marketing strategies for getting products to market at competitive prices',
      'the growth advantages individual economies enjoy by keeping their own currencies',
      'how a common currency strengthens the economy through cost savings and reinvestment',
      'economic losses caused by a lack of markets and customers',
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
    report.push({ id: f.id, source: doc.source, type: f.type, ca: f.ca, action: APPLY ? '교체' : '교체 예정' });
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
