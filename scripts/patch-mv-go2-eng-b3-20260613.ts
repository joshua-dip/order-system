/**
 * MV-20260612-001 한글 선택지 영어화 배치3: 2017수능 31번 + 2014수능A형 35번 (12건, 2026-06-13).
 * 사용: npx tsx scripts/patch-mv-go2-eng-b3-20260613.ts [--apply]
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
  // ── 2017수능 31번 (creativity / overstructuring)
  {
    id: '6a2bb2d2647637723fc4e3d7', type: '불일치', ca: '③', mustInclude: '다양한 선택권을 넓히고 자유로운 결과',
    options: [
      'The creativity children possess needs to be cultivated throughout their development.',
      "Overstructuring a child's environment may limit creative and academic development.",
      'Exercises or activities are devised to broaden various options and lead to free outcomes.',
      'As answers are structured to fit course assessments, the wonder of science is lost.',
      'Cognitive intrigue is defined as the wonder that stimulates an individual to voluntarily engage in an activity.',
    ],
  },
  {
    id: '6a2bb2d2647637723fc4e3d8', type: '불일치', ca: '⑤', mustInclude: '다양하고 폭넓은 사고를 요구한다',
    options: [
      'Overstructuring the environment is a central problem with much of science instruction.',
      'The loss of cognitive intrigue can be reinforced by rote instruction in school.',
      'Cognitive intrigue is the wonder that intrinsically motivates an individual to engage in an activity.',
      'The sole use of play items with predetermined conclusions can initiate the loss of cognitive intrigue.',
      'Toys and games that are an end in themselves require diverse and broad thinking from the individual.',
    ],
  },
  {
    id: '6a2bb2d2647637723fc4e3e3', type: '일치', ca: '①', mustInclude: '창의적·학문적 발달을 제한할 수 있다',
    options: [
      "Overstructuring a child's environment may limit creative and academic development.",
      'Exercises or activities are devised to broaden various options.',
      'Answers are freely constructed regardless of course assessments.',
      'The loss of cognitive intrigue is weakened by school education.',
      'The wonder of science is reinforced along with cognitive intrigue.',
    ],
  },
  {
    id: '6a2bb2d3647637723fc4e3e4', type: '일치', ca: '①', mustInclude: '자발적으로 참여하도록 동기를 부여하는 경이감',
    options: [
      'Cognitive intrigue is the wonder that motivates an individual to voluntarily engage in an activity.',
      "Children's creativity needs to be cultivated only in the early stage of growth.",
      'Exercises or activities are designed to exclude predetermined results.',
      'The loss of cognitive intrigue stems from the diverse use of play items.',
      "Science education is a key means of promoting a child's creative development.",
    ],
  },
  {
    id: '6a2bb2d3647637723fc4e3e9', type: '주제', ca: '①', mustInclude: '지나친 환경의 구조화가 아이의 창의성 발달에 미치는 부정적',
    options: [
      "the negative effect of overstructuring the environment on a child's creativity development",
      'the benefit that presenting accurate answers in science education gives to academic achievement',
      'the learning efficiency of repetitive learning that masters predetermined objectives',
      "the importance of choosing play items suited to a child's cognitive developmental stage",
      'how rote education contributes to the objectivity of test assessment',
    ],
  },
  {
    id: '6a2bb2d3647637723fc4e3ea', type: '주제', ca: '③', mustInclude: '암기식 교육이 인지적 호기심을 약화시키는 문제',
    options: [
      'the positive change that standardized testing brings to the science curriculum',
      'the educational value of mastering planned objectives through toys and games',
      'the problem of overstructuring the environment and rote education weakening cognitive intrigue',
      'the correlation between childhood creativity and adult academic achievement',
      'the design principles of a reward system to increase voluntary participation in activities',
    ],
  },
  // ── 2014수능A형 35번 (customer requests / ramifications)
  {
    id: '6a2c46bf203495207ecda53f', type: '불일치', ca: '③', mustInclude: '충분히 고려한 뒤 요청한다',
    options: [
      'A result a customer tries to achieve in one area can have a negative effect on other outcomes.',
      'A traveling salesperson may fail to consider how hard a smaller cell phone will be to use.',
      'A carpenter requests a lightweight circular saw only after fully considering that it may lack the power for difficult jobs.',
      'When requesting a new feature, customers usually focus on solving just one problem.',
      'Customers may reject the resulting product when they realize the problems caused by their suggestion.',
    ],
  },
  {
    id: '6a2c46bf203495207ecda540', type: '불일치', ca: '④', mustInclude: '충분히 검토한 뒤 새 기능을 요구',
    options: [
      'All the outcomes a customer tries to achieve in one area sometimes negatively affect other outcomes.',
      "This is very common when companies are busy listening to the 'voice of the customer.'",
      'Traveling salespeople may say they want a smaller cell phone.',
      'Customers request a new feature only after fully examining how their requested solution will affect other functions.',
      'An added feature sometimes turns out to be worthless because of the problems it causes.',
    ],
  },
  {
    id: '6a2c46bf203495207ecda54f', type: '일치', ca: '①', mustInclude: '한 부분에서 추구하는 결과가 다른 결과에 부정적',
    options: [
      'A result pursued in one area can have a negative effect on other outcomes.',
      'Traveling salespeople say they want a larger cell phone.',
      "Carpenters fully consider the effect of a saw's weight on the job.",
      'When requesting a new feature, customers consider several problems at once.',
      "An added feature always turns out to raise the product's value.",
    ],
  },
  {
    id: '6a2c46bf203495207ecda550', type: '일치', ca: '③', mustInclude: '가벼운 원형 톱은 어려운 작업을 처리할 힘을 잃을 수 있다',
    options: [
      'Listening to the voice of the customer is very rare in companies.',
      'Salespeople say a small phone is more convenient to use.',
      'A lightweight circular saw may lose the power to handle difficult jobs.',
      'The solution a customer requests does not affect other functions.',
      'Customers accept the resulting product as it is even after realizing the problem.',
    ],
  },
  {
    id: '6a2c46c0203495207ecda553', type: '주제', ca: '①', mustInclude: '다른 기능에 미치는 부정적 영향에 대한 간과',
    options: [
      'the overlooking of the negative effect a customer-requested feature has on other functions',
      'the importance of listening to the voice of the customer in product development',
      'the market competitiveness of customized products reflecting diverse consumer demands',
      'the economic value of thorough market research before launching a new product',
      'the technical limits of making products lighter using advanced technology',
    ],
  },
  {
    id: '6a2c46c0203495207ecda554', type: '주제', ca: '③', mustInclude: '단편적 요구가 초래하는 제품 기능상의 부작용',
    options: [
      'the effect of cell phone miniaturization on usability',
      'the common features of products preferred by salespeople and carpenters',
      "the side effects on product functions caused by customers' fragmentary requests",
      'product design strategies to increase customer satisfaction',
      'the benefits of smooth communication between companies and consumers',
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
