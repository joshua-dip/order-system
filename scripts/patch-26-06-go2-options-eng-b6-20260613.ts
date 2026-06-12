/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 6: 33·34·35번 27건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b6-20260613.ts [--apply]
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
  // ── 33번 (Evolution tracks environment)
  {
    id: '6a2222308d91251beb10f50a', type: '불일치', ca: '④', mustInclude: '더 짧은 털을 자라게 하는 방향',
    options: [
      'Evolution comes to a standstill until something in the conditions changes.',
      'The onset of an ice age or a change in average rainfall is an example of changing conditions.',
      'Evolution normally does not halt but constantly tracks the changing environment.',
      'If the average temperature drifts steadily downward, animals are propelled toward growing shorter coats of hair.',
      'Such changes do happen when dealing with a timescale as long as the evolutionary one.',
    ],
  },
  {
    id: '6a2222308d91251beb10f50b', type: '불일치', ca: '③', mustInclude: '항상 일정한 속도로 진행된다',
    options: [
      'A shift in the prevailing wind is one of the condition changes that can set evolution going again.',
      'A downward drift in temperature means a trend that persists over centuries.',
      'Evolution always proceeds at a constant rate regardless of environmental change.',
      'When temperatures rise again, animals come under a new selection pressure.',
      'A steady downward temperature trend acts as a steady selection pressure on animals.',
    ],
  },
  {
    id: '6a2222308d91251beb10f50c', type: '불일치', ca: '⑤', mustInclude: '짧은 시간 규모에서만',
    options: [
      'Evolution stays at a standstill until a change occurs in the conditions.',
      'Such changes do happen when dealing with timescales as long as the evolutionary one.',
      'If average temperature drifts steadily downward, the next generations move toward longer coats of hair.',
      'If the trend reverses after thousands of years of reduced temperature, animals move toward shorter coats.',
      'A change in average rainfall is a factor that halts evolution only on a short timescale.',
    ],
  },
  {
    id: '6a2222318d91251beb10f51c', type: '일치', ca: '①', mustInclude: '환경 변화를 무시한다',
    options: [
      'Evolution comes to a standstill until something in the conditions changes.',
      'On a timescale as long as the evolutionary one, such changes do not happen.',
      'Evolution usually stays at a standstill and ignores environmental change.',
      'A downward drift in average temperature is a temporary phenomenon that ends within days.',
      'When temperatures fall, animals move toward growing shorter coats of hair.',
    ],
  },
  {
    id: '6a2222318d91251beb10f51d', type: '일치', ca: '②', mustInclude: '포함되지 않는다',
    options: [
      'The onset of an ice age is not among the condition changes that affect evolution.',
      'If the average temperature drifts steadily downward, the next generations of animals move toward growing longer coats of hair.',
      'Once a selection pressure forms, it does not change even if the temperature changes.',
      'A shift in the prevailing wind is a factor unrelated to evolution.',
      'Evolution cannot track environmental change and proceeds in only one direction.',
    ],
  },
  {
    id: '6a2222318d91251beb10f51e', type: '일치', ca: '③', mustInclude: '일정한 속도로 진행된다',
    options: [
      'Evolution proceeds at a constant rate regardless of any change in external conditions.',
      'A change in average rainfall is not among the condition changes that halt evolution.',
      'When the temperature slowly rises again, animals move toward growing shorter coats of hair.',
      'A downward drift in average temperature shows its effect within a single generation.',
      'Animals always keep the same coat length regardless of temperature change.',
    ],
  },
  {
    id: '6a2222318d91251beb10f525', type: '주제', ca: '①', mustInclude: '멸종에 미치는 결정적',
    options: [
      'the persistence of evolution constantly following the changing environment',
      'the decisive impact of ice ages on animal extinction',
      'the diversity of genes that determine the length of an animal’s coat',
      'the complexity of environmental factors that make climate prediction difficult',
      'the environmental conditions under which evolution comes to a complete standstill',
    ],
  },
  {
    id: '6a2222318d91251beb10f526', type: '주제', ca: '②', mustInclude: '서식지 면적의 상관관계',
    options: [
      'the correlation between an animal’s body size and the area of its habitat',
      'evolution that continues, changing direction along with environmental change',
      'the long-term effect of changes in average rainfall on vegetation',
      'why chance plays a greater role in evolution than natural selection',
      'the process by which the movement of prevailing winds triggers an ice age',
    ],
  },
  {
    id: '6a2222318d91251beb10f527', type: '주제', ca: '④', mustInclude: '영구히 멈추게 하는 안정된',
    options: [
      'the conditions of a stable environment that halt evolution permanently',
      'the various survival strategies animals use to endure the cold',
      'the effect of temperature change on the reproductive cycle of animals',
      'evolution that constantly follows environmental change and shifts direction',
      'the importance of generation turnover time in determining the pace of evolution',
    ],
  },
  // ── 34번 (Sidewalk vending carts)
  {
    id: '6a2222328d91251beb10f52e', type: '불일치', ca: '⑤', mustInclude: '별도의 허가 없이 무료로 제공된다',
    options: [
      'Sidewalk vending carts in New York City sell everything from hot dogs to ice cream.',
      'Vending carts are so popular that there are over 3,000 in New York City alone.',
      'Retail space along Madison Avenue rents for an average of $550 a year per square foot.',
      'Operating a hot dog cart requires about 4 square yards of space.',
      'Space on the public sidewalk is free to vendors without any permits.',
    ],
  },
  {
    id: '6a2222328d91251beb10f52f', type: '불일치', ca: '④', mustInclude: '최대 5,500달러가 들 수 있다',
    options: [
      'High land prices in metropolitan areas affect the efficient use of resources.',
      'Resources used to supply hot dogs include land, labor, capital, and entrepreneurial ability.',
      'Hot dog sausages and buns are intermediate-good resources.',
      'Renting commercial space the size of a hot dog cart could cost up to $5,500 a year.',
      'Profit-maximizing vendors use public sidewalks instead of costly commercial space.',
    ],
  },
  {
    id: '6a2222328d91251beb10f530', type: '불일치', ca: '⑤', mustInclude: '공공 허가를 포함한 모든',
    options: [
      'Sidewalk vending carts in New York City operate as they do in many other large cities.',
      'The popularity of vending carts is examined in terms of the cost of resources.',
      'Retail space on Madison Avenue rents for an average of $550 a year per square foot.',
      'The space needed to operate a hot dog cart is about 4 square yards.',
      'All sidewalk-use costs, including public permits, are free to vendors.',
    ],
  },
  {
    id: '6a2222328d91251beb10f540', type: '일치', ca: '①', mustInclude: '핫도그만 판매한다',
    options: [
      'There are over 3,000 sidewalk vending carts in New York City.',
      'Sidewalk vending carts sell only hot dogs.',
      'Retail space on Madison Avenue rents for an average of $50 a year per square foot.',
      'Operating a hot dog cart requires about 40 square yards.',
      'Vendors pay an expensive fee for space on the public sidewalk.',
    ],
  },
  {
    id: '6a2222328d91251beb10f541', type: '일치', ca: '③', mustInclude: '공공 허가는 필요 없다',
    options: [
      'Low land prices in metropolitan areas affect resource use.',
      'No public permit is needed to operate a hot dog cart.',
      'Renting that much commercial space could cost as much as $20,000 a year.',
      'Labor and capital are included among the intermediate goods used to supply hot dogs.',
      'Sidewalk vending carts are unpopular in large cities.',
    ],
  },
  {
    id: '6a2222338d91251beb10f542', type: '일치', ca: '④', mustInclude: '기업가의 능력은 포함되지 않는다',
    options: [
      'Entrepreneurial ability is not included among the resources used to supply hot dogs.',
      'Profit-maximizing vendors prefer expensive commercial space.',
      'Sidewalk vending carts exist only in New York City.',
      'Profit-maximizing vendors use public sidewalks instead of costly commercial space.',
      'Retail space on Madison Avenue is priced on a monthly basis.',
    ],
  },
  {
    id: '6a2222338d91251beb10f549', type: '주제', ca: '①', mustInclude: '관광객에게 주는 매력',
    options: [
      'street vendors’ rational choice of resources to avoid high land costs',
      'the appeal of the diversity of big-city street food to tourists',
      'conflict between vendors and authorities over use of public sidewalks',
      'how to procure the various intermediate goods needed to run a hot dog cart',
      'the effect of rising retail rents on the decline of downtown commerce',
    ],
  },
  {
    id: '6a2222338d91251beb10f54a', type: '주제', ca: '②', mustInclude: '혼잡 문제를 해결하기 위한',
    options: [
      'changes in the types and prices of food sold by New York City vendors',
      'vendors’ resource-saving strategy of using free public space instead of costly commercial space',
      'policy efforts to solve the problem of crowded city sidewalks',
      'how the public permit system creates entry barriers for street vending',
      'the decisive role of entrepreneurial ability in small-business success',
    ],
  },
  {
    id: '6a2222338d91251beb10f54b', type: '주제', ca: '⑤', mustInclude: '사랑받는 정서적 이유',
    options: [
      'the status of street food in the development of big-city food culture',
      'various standards and methods for pricing commercial real estate',
      'the emotional reasons why hot dog carts are loved by New Yorkers',
      'a debate over which resource, capital or labor, matters more to a business',
      'the effect of high land prices on how street vendors use resources',
    ],
  },
  // ── 35번 (Interpreting art with context)
  {
    id: '6a2222338d91251beb10f552', type: '불일치', ca: '③', mustInclude: '단서를 줄 수 없다',
    options: [
      'The process of recognizing and making sense of an artwork’s content is not just visual.',
      'It is also a mental process, largely based on elements we can identify and categorize.',
      'Where a work is or when it was made cannot give any clues to its meaning.',
      'Any information we can gather helps us understand the work’s context.',
      'We use the contextual information we have gathered to interpret the work’s content.',
    ],
  },
  {
    id: '6a2222338d91251beb10f553', type: '불일치', ca: '④', mustInclude: '작품을 보기 전에 먼저 완료된다',
    options: [
      'The process of looking at a work is not just visual but also a mental process.',
      'A work’s context includes historical, social, personal, political, and scientific reasons.',
      'Who created a work can be a clue to its meaning.',
      'Interpreting the contextual information is completed before looking at the work.',
      'We interpret a work’s content to discover what it means or symbolizes.',
    ],
  },
  {
    id: '6a2222338d91251beb10f554', type: '불일치', ca: '③', mustInclude: '거의 도움이 되지 않는다',
    options: [
      'The mental process is largely based on elements within and about the work that we can identify and categorize.',
      'What culture a work came from can be a clue to its meaning.',
      'The information we can gather is of little help in understanding a work’s context.',
      'A work’s context means the reasons for which it was made.',
      'Interpreting a work’s content is meant to discover what it means or symbolizes.',
    ],
  },
  {
    id: '6a2222348d91251beb10f564', type: '일치', ca: '①', mustInclude: '순수한 시각 과정이다',
    options: [
      'The process of understanding an artwork’s content is not just visual.',
      'Looking at an artwork is a pure visual process with no mental element.',
      'Clues to a work’s meaning are given only by the colors of the work itself.',
      'No information helps in understanding a work’s context.',
      'We interpret a work’s content before gathering any contextual information.',
    ],
  },
  {
    id: '6a2222348d91251beb10f565', type: '일치', ca: '②', mustInclude: '정신적 과정과는 무관하다',
    options: [
      'Looking at an artwork is only a visual process, unrelated to any mental process.',
      'The information we gather helps us understand the work’s context.',
      'Clues to a work are determined only by the time it was made.',
      'A work’s context is explained only by social reasons, excluding historical ones.',
      'We can immediately grasp a work’s symbolic meaning even without contextual information.',
    ],
  },
  {
    id: '6a2222348d91251beb10f566', type: '일치', ca: '③', mustInclude: '외부 요소를 전혀 고려하지 않는다',
    options: [
      'Appreciating a work considers no elements outside the work at all.',
      'A work’s context has nothing to do with where the work is.',
      'We use the contextual information we have gathered to interpret the work’s content.',
      'The mental process occurs independently of elements we can identify and categorize.',
      'What culture a work came from has nothing to do with its meaning.',
    ],
  },
  {
    id: '6a2222348d91251beb10f56d', type: '주제', ca: '①', mustInclude: '시대별 미술 양식의 변화',
    options: [
      'the role of contextual information in grasping the meaning of an artwork',
      'the effect of changes in art styles across eras on appreciation',
      'the mismatch between an artist’s intention and the viewer’s interpretation',
      'the importance of visual training in art education',
      'the factors that determine an artwork’s economic value in the art market',
    ],
  },
  {
    id: '6a2222358d91251beb10f56e', type: '주제', ca: '③', mustInclude: '관람객 동선에 주는 효과',
    options: [
      'the effect of museum exhibition space design on visitors’ movement',
      'differences in expression techniques between abstract and representational art',
      'the mental process of interpreting an artwork’s content using contextual information',
      'scientific restoration techniques for preserving artworks',
      'the need for art activities to develop creative expression',
    ],
  },
  {
    id: '6a2222358d91251beb10f56f', type: '주제', ca: '④', mustInclude: '감정적 반응이 우선되어야',
    options: [
      'why an individual’s emotional response should come first in appreciating art',
      'objective standards for evaluating the outward beauty of a work',
      'the changes digital technology has brought to modern art creation',
      'the appreciation process of grasping a work’s context to reveal its meaning and symbolism',
      'methods for distinguishing the authenticity of sources in art-history research',
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
