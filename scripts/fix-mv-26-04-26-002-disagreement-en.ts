/**
 * MV-20260426-002 의 불일치 유형 15문항 — Options 한글 → 영어 전환.
 * Explanation 도 영어 선택지와 정합되게 미세 조정.
 *
 * 사용: npx tsx scripts/fix-mv-26-04-26-002-disagreement-en.ts
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

type Patch = {
  id: string;
  options: string;
  explanation?: string;
};

const PATCHES: Patch[] = [
  // 23번(2024) - Industrial Age
  {
    id: '69eda46af451f9243bc2b7ad',
    options:
      '① The arrival of the Industrial Age changed the relationship among time, labor, and capital.\n' +
      '② Factories could produce around the clock with greater speed and volume than ever before.\n' +
      '③ A machine running twelve hours a day produces more widgets than one running twenty-four hours a day.\n' +
      '④ At many factories, the workday was divided into eight-hour shifts.\n' +
      '⑤ Labor, previously guided by harvest cycles, became clock-oriented.',
  },
  {
    id: '69eda474f451f9243bc2b7ae',
    options:
      '① Industrialization raised the potential value of every single work hour.\n' +
      '② Wages became tied to effort and production.\n' +
      '③ Society started to reorganize around new principles of productivity.\n' +
      '④ Eight-hour shifts were introduced so that machines could rest.\n' +
      '⑤ Before industrialization, labor was guided by harvest cycles.',
  },
  {
    id: '69eda480f451f9243bc2b7af',
    options:
      '① Factories were able to produce around the clock even before the Industrial Age.\n' +
      '② A machine that runs twenty-four hours a day produces the most widgets.\n' +
      '③ The more hours you worked, the more money you made.\n' +
      '④ Industrialization tied wages to effort and production.\n' +
      '⑤ Society started to reorganize around principles of productivity.',
  },

  // 32번(2024) - Education / critical thinking
  {
    id: '69eda5baf451f9243bc2b7c2',
    options:
      '① At its best, education teaches more than just knowledge.\n' +
      '② Critical thinking is the ability to stop and think before acting.\n' +
      '③ Critical thinking is the same as thought control.\n' +
      '④ Even the most advanced intellectual is imperfect at this skill.\n' +
      '⑤ Living by instinct and emotion is, in many ways, a very easy way to live.',
  },
  {
    id: '69eda5c3f451f9243bc2b7c3',
    options:
      '① Critical thinking is mental liberation.\n' +
      '② Thought is effortful, especially for the inexperienced.\n' +
      '③ Emotions are exhausting.\n' +
      '④ Short-term reactions are, in the long term, always the most beneficial for health and survival.\n' +
      '⑤ Our reliance on feelings can do us great harm.',
  },
  {
    id: '69eda5d0f451f9243bc2b7c4',
    options:
      '① Critical thinking is the ability to avoid succumbing to emotional pressures.\n' +
      '② Critical thinking is the very opposite of mental liberation.\n' +
      '③ Imperfect possession of critical thinking frees a person from the burden of being stimulus-driven.\n' +
      '④ We reach for burgers for convenience, storing up arterial fat.\n' +
      '⑤ Reliance on feelings can do us great harm.',
  },

  // 23번(2025) - Transit speed/frequency
  {
    id: '69eda6c6f451f9243bc2b7d7',
    options:
      '① For peak-only commute services, speed may be emphasized over frequency.\n' +
      '② Roads are there all the time, so their speed is the most important fact that distinguishes them.\n' +
      '③ Transit is always there, so it should be judged by the same standards as roads.\n' +
      '④ If you have a car, you can use a road whenever you want and experience its speed.\n' +
      '⑤ With low frequency, time savings from a faster service can be wiped out by waiting time.',
  },
  {
    id: '69eda6d1f451f9243bc2b7d8',
    options:
      "① Emphasizing speed over frequency seems to be a common motorist's error in most contexts.\n" +
      '② Transit has to exist when you need it and must be coming soon.\n' +
      '③ Even with a fast service, low frequency can wipe out any time savings due to waiting.\n' +
      '④ A transit map that emphasizes both frequency and speed always provides clear information.\n' +
      '⑤ Unless you can plan your life around a particular scheduled trip, speed is worthless without frequency.',
  },
  {
    id: '69eda6e3f451f9243bc2b7d9',
    options:
      '① Roads exist only when they are coming soon.\n' +
      '② For transit, frequency matters because it must be coming soon.\n' +
      '③ For peak-only commute services, timetable-based planning is possible.\n' +
      "④ If you have a car, you can experience a road's speed whenever you want.\n" +
      '⑤ A transit map focused only on speed may plant confusion.',
  },

  // 24번(2025) - Culturtainment
  {
    id: '69eda7e1f451f9243bc2b7ec',
    options:
      '① The economic benefit of culturtainment is attractive to both politicians and policy makers.\n' +
      '② Governments and authorities work with cultural groups to develop celebrations and commemorations into larger, higher-profile events.\n' +
      '③ Commercialization risks the homogenization of culturtainment and the loss of its original message.\n' +
      '④ Smaller independent events caused by commercialization have the effect of unifying audiences.\n' +
      '⑤ Overall, culturtainment is a healthy growth sector of the entertainment industry.',
  },
  {
    id: '69eda7ecf451f9243bc2b7ed',
    options:
      '① An increase in inbound visitors, along with demand for travel, accommodation, and retail, acts as an incentive for governments.\n' +
      '② Commercialization can lead to a dilution of audiences.\n' +
      '③ Planners and stakeholders need to balance against potential financial gain.\n' +
      '④ Changing political, social and religious landscapes will lead to new cultures and culturtainment experiences.\n' +
      '⑤ Culturtainment is, by its very nature, strong in the face of exploitation.',
  },
  {
    id: '69eda7f5f451f9243bc2b7ee',
    options:
      '① Governments and authorities are indifferent to the economic potential of culturtainment.\n' +
      '② Commercialization can bring the risk of culturtainment becoming homogeneous.\n' +
      '③ When commercialization dilutes the message, audiences may be divided.\n' +
      '④ Changing political, social and religious landscapes lead to new culturtainment experiences.\n' +
      '⑤ Overall, culturtainment is a healthy growth sector of the entertainment industry.',
  },

  // 31번(2025) - Grain trade firms
  {
    id: '69eda8e9f451f9243bc2b801',
    options:
      '① Early grain trade firms were active in both surplus-producing and food deficit regions.\n' +
      '② Because information was the key to profitability, the firms operated in relative secrecy.\n' +
      '③ The firms benefited from the rise of commodity exchanges and futures markets in the mid-1800s.\n' +
      '④ Agricultural markets are, due to weather variations, naturally stable.\n' +
      '⑤ Locking in prices for future grain delivery helped firms minimize risks.',
  },
  {
    id: '69eda8f5f451f9243bc2b802',
    options:
      '① Early grain trade firms were often built on family ties, trust, and loyalty.\n' +
      '② It made sense for grain trading companies to operate as independent national companies trading with each other rather than as a single multinational firm.\n' +
      '③ Grain trading firms easily covered risks through their access to information in multiple markets.\n' +
      '④ Commodity futures markets emerged in the mid-1800s.\n' +
      '⑤ Buying and selling grain for future delivery to lock in prices minimized risks.',
  },
  {
    id: '69eda900f451f9243bc2b803',
    options:
      "① Early grain trade firms made it their business to know the supply-and-demand state of both regions.\n" +
      "② Access to information was the key to the firms' profitability.\n" +
      '③ Agricultural market instability stems from harvest size variations.\n' +
      "④ Family ties and trust were unrelated to the secrecy of the firms' operations.\n" +
      '⑤ A single firm operating in more than one country was rational for risk management.',
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let updated = 0;
  let skipped = 0;

  for (const p of PATCHES) {
    const _id = new ObjectId(p.id);
    const doc = await col.findOne({ _id });
    if (!doc) {
      console.log(`SKIP not found: ${p.id}`);
      skipped++;
      continue;
    }
    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...qd, Options: p.options };
    if (p.explanation) next.Explanation = p.explanation;
    await col.updateOne({ _id }, { $set: { question_data: next, updated_at: new Date() } });
    updated++;
    console.log(`OK ${p.id}  source=${doc.source}`);
  }

  console.log(`\nDONE  updated=${updated}  skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
