/**
 * MV-20260612-001 한글 선택지 영어화 배치4: 22년 9월 고2 37번 + 2011수능 26번 + 20년 6월 고3 40번 (18건, 2026-06-13).
 * 사용: npx tsx scripts/patch-mv-go2-eng-b4-20260613.ts [--apply]
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
  // ── 22년 9월 고2 37번 (reasons foster humility)
  {
    id: '6a2bb2cb647637723fc4e38f', type: '불일치', ca: '④', mustInclude: '어떤 주장도 반박되지 않을 때는 양측 모두 근거가 전혀 없는',
    options: [
      'Reasons and arguments have the benefit of fostering humility.',
      'If two people only disagree without arguing, they just yell at each other.',
      'When one argument is refuted, the person who relied on it learns to change his view.',
      'When no argument is refuted, both sides have no reason at all on their side.',
      "One can gain humility when recognizing and understanding the reasons against one's own view.",
    ],
  },
  {
    id: '6a2bb2cb647637723fc4e390', type: '불일치', ca: '③', mustInclude: '설득되지 않으면 양측은 결코 반대 견해를 이해할 수 없다',
    options: [
      'When both sides give arguments articulating reasons for their positions, new possibilities open up.',
      'For an argument to be refuted is for it to be shown to fail.',
      "If they are not convinced by each other's argument, the two sides can never appreciate the opposing view.",
      'People realize that even if they have some truth, they do not have the whole truth.',
      'When people only disagree without arguing, no progress is made.',
    ],
  },
  {
    id: '6a2bb2cc647637723fc4e39b', type: '일치', ca: '①', mustInclude: '고함을 지르며 어떠한 발전도 없다',
    options: [
      'If people only disagree without arguing, they yell at each other and no progress is made.',
      'The benefit of reasons and arguments lies in fostering superiority by making the other submit.',
      'When an argument is refuted, the person who relied on it holds on to his view.',
      'When both sides present arguments, new possibilities close and dialogue breaks down.',
      'When no argument is refuted, both sides come to ignore the opposing view.',
    ],
  },
  {
    id: '6a2bb2cd647637723fc4e39c', type: '일치', ca: '③', mustInclude: '반대되는 근거를 인식하고 이해할 때 겸손',
    options: [
      'When no argument is refuted, both sides have no reason at all.',
      'If not convinced by the other, one can never understand the opposing view.',
      'People can gain humility when they recognize and appreciate the reasons against their own view.',
      'Both sides are convinced they have the whole truth with only a little truth.',
      'The person who relied on a refuted argument insists to the end that he is right.',
    ],
  },
  {
    id: '6a2bb2cd647637723fc4e3a1', type: '주제', ca: '①', mustInclude: '합리적 근거를 갖춘 주장이 겸손을 길러 주는 방식',
    options: [
      'how arguments with reasonable grounds foster humility',
      'the persuasion skills one must have to win an argument',
      'the types of refutation strategies effective in making the other submit',
      'the negative effect of emotional confrontation on communication',
      'the danger of thinking that fails to accept diverse perspectives',
    ],
  },
  {
    id: '6a2bb2cd647637723fc4e3a2', type: '주제', ca: '③', mustInclude: '근거에 기반한 논증이 겸손한 자세를 이끌어 내는 과정',
    options: [
      'the limits of an attitude that avoids conflict through silence',
      'the importance of following the majority opinion in a debate',
      'the process by which reason-based argumentation leads to a humble attitude',
      "the value of a conviction that holds one's position to the end",
      "the usefulness of a logical style that targets the opponent's weaknesses",
    ],
  },
  // ── 2011수능 26번 (purpose as transaction)
  {
    id: '6a2c46be203495207ecda527', type: '불일치', ca: '⑤', mustInclude: '무한대에 가깝고 자산이 0에 가까운',
    options: [
      'When wholly concentrated on a result, the more quickly and easily it is brought about, the better.',
      'The resolve to secure food induces one to spend weary days tilling the ground and tending livestock.',
      'If Nature provided food in abundance, one would thank it for sparing the labor.',
      'An executed purpose is a transaction in which time and energy spent are balanced against the resulting assets.',
      'The ideal case is one in which time and energy approximate infinity and assets approximate zero.',
    ],
  },
  {
    id: '6a2c46be203495207ecda528', type: '불일치', ca: '③', mustInclude: '노동 없이도 자산이 저절로 무한대로',
    options: [
      'As long as one is wholly concentrated on a result, it is clear that the quicker and easier it is achieved, the better.',
      'If Nature provided enough food and meat for the table, one would consider oneself much better off.',
      'The resolve to secure food makes assets grow infinitely by themselves without labor.',
      'An executed purpose is a transaction in which time and energy are balanced against the resulting assets.',
      'Purpose justifies the efforts it exacts only conditionally, by their fruits.',
    ],
  },
  {
    id: '6a2c46be203495207ecda537', type: '일치', ca: '①', mustInclude: '노동을 줄이려는 마음을 약화',
    options: [
      'When wholly concentrated on a result, the more quickly and easily it is achieved, the better.',
      'The resolve to secure enough food weakens the desire to reduce labor.',
      'If Nature provided food abundantly, people would rather want to work more.',
      'In the transaction, the ideal case is one in which time and energy spent approximate infinity.',
      'Purpose justifies the effort unconditionally, regardless of its fruits.',
    ],
  },
  {
    id: '6a2c46be203495207ecda538', type: '일치', ca: '②', mustInclude: '노동을 면한 것에 대해 자연에게 감사',
    options: [
      'The more slowly and with more difficulty a result is achieved, the more valuable it is.',
      'If Nature provided food in abundance, people would thank Nature for sparing them much labor.',
      'The resolve to secure food keeps one away from tilling the ground.',
      'In the transaction of an executed purpose, time spent and assets are unrelated to each other.',
      'Purpose justifies the effort it requires without any condition.',
    ],
  },
  {
    id: '6a2c46be203495207ecda53b', type: '주제', ca: '①', mustInclude: '조건부로 정당화되는 목적의 본질',
    options: [
      'the nature of purpose, which is justified only conditionally by the fruits of effort',
      'human moral value cultivated through labor',
      'the limits of the abundance Nature provides to humans',
      'why we should value the process over efficiency',
      'the social importance of securing food for the family',
    ],
  },
  {
    id: '6a2c46be203495207ecda53c', type: '주제', ca: '③', mustInclude: '노력 대비 결실로 평가되는 목적 수행의 거래적',
    options: [
      "humans' instinctive desire to conquer nature",
      'the development of efficient farming technology for food production',
      'the transactional nature of carrying out a purpose, evaluated by fruits relative to effort',
      'a life attitude that finds reward in labor itself rather than the result',
      'the conflict between humans and nature over infinite resources',
    ],
  },
  // ── 20년 6월 고3 40번 (limits of the fossil record)
  {
    id: '6a2c46bc203495207ecda50f', type: '불일치', ca: '②', mustInclude: '더 많은 개체가 있었음을 반드시 의미한다',
    options: [
      'Some environments are more likely to lead to fossilization and discovery than others.',
      'More fossil evidence from a particular time or place necessarily means more individuals were there.',
      'The absence of fossil evidence at a time or place does not carry the same implication as its presence.',
      'A taxon may have arisen before it first appears in the fossil record.',
      'The first and last appearance data may be conservative statements about the times of origin and extinction.',
    ],
  },
  {
    id: '6a2c46bc203495207ecda510', type: '불일치', ca: '③', mustInclude: '존재할 때와 동일한 의미를 갖는다',
    options: [
      'Circumstances favourable for fossilization can vary by time or place.',
      "The saying 'absence of evidence is not evidence of absence' is quoted.",
      'The absence of fossil evidence at a time or place has the same meaning as its presence.',
      'A taxon may have survived beyond the time of its most recent appearance in the fossil record.',
      'The first and last appearance data may be conservative statements about origin and extinction.',
    ],
  },
  {
    id: '6a2c46bd203495207ecda51f', type: '일치', ca: '③', mustInclude: '화석 증거의 부재는 그 존재와 동일한 함의를 갖지 않는다',
    options: [
      'All environments are equally likely for fossilization to occur.',
      'More fossil evidence always means more individuals were present.',
      'The absence of fossil evidence does not carry the same implication as its presence.',
      'A taxon arose only after it first appeared in the fossil record.',
      'The first appearance datum is a statement that exaggerates the time of origin.',
    ],
  },
  {
    id: '6a2c46bd203495207ecda520', type: '일치', ca: '①', mustInclude: '처음 등장하기 전에 이미 생겨났을 가능성',
    options: [
      'A taxon may have arisen before it first appears in the fossil record.',
      'Circumstances favourable for fossilization are the same in all times and places.',
      'The absence of hominin fossil evidence carries exactly the same meaning as its presence.',
      'A taxon went extinct immediately at the time of its most recent fossil appearance.',
      'The last appearance datum is a statement that places extinction later than it really was.',
    ],
  },
  {
    id: '6a2c46bd203495207ecda523', type: '주제', ca: '①', mustInclude: '화석 기록의 한계로 인한 화석 증거 해석의 신중함',
    options: [
      'caution in interpreting fossil evidence due to the limits of the fossil record',
      'the diversity of environmental factors that promote the fossilization process',
      'the importance of fossil-excavation technology in human-evolution research',
      'academic debate over the times of origin and extinction of taxa',
      'the development of statistical methods for estimating paleo-population sizes',
    ],
  },
  {
    id: '6a2c46bd203495207ecda524', type: '주제', ca: '③', mustInclude: '화석 증거의 불완전성으로 인해 신중히 해석',
    options: [
      'the geological conditions under which environments favourable for fossilization form',
      'the assumption that the fossil record directly reflects actual biological facts',
      'the fossil record, which must be interpreted with caution due to the incompleteness of fossil evidence',
      'how to pinpoint exactly when human ancestors appeared and went extinct',
      'the proportional relationship between fossil-discovery frequency and past population size',
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
