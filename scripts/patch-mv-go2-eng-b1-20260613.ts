/**
 * MV-20260612-001 한글 선택지 영어화 배치1: 18년 9월 고2 37번 + 24년 3월 고2 34번 (12건, 2026-06-13).
 * 원문 대조, 정답 슬롯·해설 유지, ### 재조립(형식 동시 해결). mustInclude 가드.
 * 사용: npx tsx scripts/patch-mv-go2-eng-b1-20260613.ts [--apply]
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
  // ── 18년 9월 고2 37번 (Framing / credit cards)
  {
    id: '6a2bb2ca647637723fc4e377', type: '불일치', ca: '④', mustInclude: '법안을 의회에 직접 제출',
    options: [
      'Credit cards began to become a popular form of payment in the 1970s.',
      'Some retail merchants wanted to charge different prices to cash and credit card customers.',
      'Credit card companies adopted rules forbidding retailers from charging different prices to cash and credit customers.',
      'The credit card lobby itself submitted the bill to Congress to ban such rules.',
      'The idea of framing is that choices depend, in part, on the way problems are stated.',
    ],
  },
  {
    id: '6a2bb2ca647637723fc4e378', type: '불일치', ca: '②', mustInclude: '신용카드 가격을 할인으로, 현금 가격을',
    options: [
      'The credit card lobby turned its attention to language.',
      "The lobby preferred to treat the credit price as a discount and the cash price as the 'normal' price.",
      'The lobby preferred making the credit price the normal price rather than making the cash price the usual price.',
      'The credit card companies had a good intuitive understanding of framing.',
      "The term 'framing' is what psychologists came to call it.",
    ],
  },
  {
    id: '6a2bb2cb647637723fc4e383', type: '일치', ca: '①', mustInclude: '서로 다른 가격을 청구하는 것을 장려',
    options: [
      'Credit cards began to become a popular form of payment in the 1970s.',
      'Credit card companies encouraged retailers to charge different prices.',
      'The bill introduced in Congress was meant to strengthen the price-differentiation rules.',
      'The credit card lobby preferred to make the cash price the normal price.',
      "The credit card companies lacked an intuitive understanding of 'framing'.",
    ],
  },
  {
    id: '6a2bb2cb647637723fc4e384', type: '일치', ca: '②', mustInclude: '법안은 의회에서 통과되어 시행',
    options: [
      'Retailers wanted to charge the same price to cash and credit card customers.',
      'Credit card companies adopted rules forbidding differential pricing.',
      'The bill banning the price-differentiation rules was passed and enforced by Congress.',
      'The concept of framing was first established by psychologists and then learned by the companies.',
      'Choices are made regardless of the way a problem is stated.',
    ],
  },
  {
    id: '6a2bb2cb647637723fc4e389', type: '주제', ca: '①', mustInclude: '문제가 제시되는 방식이 사람들의 선택에 미치는 영향',
    options: [
      "the influence of the way a problem is presented on people's choices",
      "why credit card companies regulated retailers' pricing",
      'various marketing strategies to encourage cash payment',
      "the legal background of Congress's attempt to ban price-discrimination rules",
      'how credit cards became a popular means of payment in the 1970s',
    ],
  },
  {
    id: '6a2bb2cb647637723fc4e38a', type: '주제', ca: '③', mustInclude: '표현 방식에 따라 동일한 상황이 다르게 받아들여지는',
    options: [
      'the history of how the credit card industry has protected consumer rights',
      'why cash and credit prices should be kept the same',
      'the framing effect, in which the same situation is perceived differently depending on how it is expressed',
      'the negative consequences of government regulation on corporate pricing',
      'the various fields in which psychology has contributed to consumer-behavior research',
    ],
  },
  // ── 24년 3월 고2 34번 (Proxies / metrics)
  {
    id: '6a2bb2d0647637723fc4e3bf', type: '불일치', ca: '③', mustInclude: '정량화하기 어려운 것들을 측정하는 쪽으로 편향',
    options: [
      'Technologists are always on the lookout for quantifiable metrics.',
      'Like a social scientist, a technologist needs to identify concrete measures to assess progress.',
      'The need for quantifiable proxies creates a bias toward measuring things that are hard to quantify.',
      'Simple metrics can take us further away from the important goals we really care about.',
      'The problem of proxies results in substituting what is measurable for what is meaningful.',
    ],
  },
  {
    id: '6a2bb2d0647637723fc4e3c0', type: '불일치', ca: '⑤', mustInclude: '항상 더 가까이 다가가게 해 준다',
    options: [
      'Making measurable inputs to a model is the lifeblood of technologists.',
      'The important goals we really care about may require complicated metrics.',
      'Having imperfect or bad proxies can create the illusion of solving a problem without genuine progress.',
      'Not everything that can be counted counts.',
      'Simple metrics always bring us closer to the important goals we really care about.',
    ],
  },
  {
    id: '6a2bb2d1647637723fc4e3cb', type: '일치', ca: '①', mustInclude: '정량화할 수 있는 측정 기준을 늘 찾는다',
    options: [
      'Technologists are always looking for quantifiable metrics.',
      'The need for quantifiable proxies creates a bias toward measuring things hard to quantify.',
      'Simple metrics bring us closer to important goals.',
      'Having imperfect proxies allows us to make genuine progress for certain.',
      'The problem of proxies makes technologists substitute what is meaningful for what is measurable.',
    ],
  },
  {
    id: '6a2bb2d1647637723fc4e3cc', type: '일치', ca: '④', mustInclude: '착각에 빠지게 할 수 있다',
    options: [
      'Making measurable inputs to a model is a trivial task for technologists.',
      'Unlike a social scientist, a technologist does not need to identify concrete measures.',
      'The important goals we really care about are easily measured with simple metrics alone.',
      'Imperfect or bad proxies can create the illusion of solving a problem for a good end.',
      'Everything that can be counted is necessarily important.',
    ],
  },
  {
    id: '6a2bb2d1647637723fc4e3d1', type: '주제', ca: '①', mustInclude: '정량화하기 쉬운 측정 기준에 대한 편향이 야기하는',
    options: [
      'the departure from true goals caused by a bias toward easily quantifiable metrics',
      'the need to standardize measurement methods in social science and technology',
      "effective ways to improve a model's accuracy by increasing measurable inputs",
      'the process by which quantitative indicators objectively prove the pace of technological progress',
      'the efficiency of technology that reduces complex metrics to simple proxies',
    ],
  },
  {
    id: '6a2bb2d1647637723fc4e3d2', type: '주제', ca: '③', mustInclude: '의미 있는 것을 측정 가능한 것으로 대체하게 만드는 문제점',
    options: [
      "technologists' various efforts and achievements to increase measurability",
      'how social scientists and technologists cooperate to assess progress',
      'the problem of proxy dependence that makes us substitute what is measurable for what is meaningful',
      'the development of new metrics to compensate for imperfect proxies',
      'the key reason quantitative metrics function as the lifeblood of a model',
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
      report.push({ id: f.id, error: `사전 조건 불일치 (type=${doc?.type}, CA=${curCa})` });
      continue;
    }
    const newOptions = f.options.map((o, i) => `${CIRCLED[i]} ${o}`).join(' ### ');
    report.push({ id: f.id, type: f.type, action: APPLY ? '교체' : '교체 예정' });
    if (APPLY) await col.updateOne({ _id: doc._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, applied: report.filter((r) => r.action).length, skipped: report.filter((r) => 'error' in r) }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
