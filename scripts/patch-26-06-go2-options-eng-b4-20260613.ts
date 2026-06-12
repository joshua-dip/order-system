/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 4: 27·28·29번 27건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b4-20260613.ts [--apply]
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
  // ── 27번 (City Tour)
  {
    id: '6a2222268d91251beb10f432', type: '불일치', ca: '④', mustInclude: '하루에 한 번으로 제한된다',
    options: [
      'You can get on or off the bus at 15 different stops.',
      'Free Wi-Fi and USB ports are available on the bus.',
      'The open-air top level provides wonderful city views.',
      'Rides are limited to once a day.',
      'You can scan QR codes to listen to information about landmarks.',
    ],
  },
  {
    id: '6a2222268d91251beb10f433', type: '불일치', ca: '③', mustInclude: '박물관 직원에게 문의',
    options: [
      'You can take unlimited rides for one day.',
      'Audio guides are available in English, Spanish, and Chinese.',
      'To listen to the audio guide, you must ask a museum staff member.',
      'You can get a discount at museums by showing your tour ticket.',
      'Prices and more information can be found on the website.',
    ],
  },
  {
    id: '6a2222268d91251beb10f434', type: '불일치', ca: '③', mustInclude: '영어, 스페인어, 프랑스어',
    options: [
      'It is a tour you can control, exploring as long as you want.',
      'USB ports are available on the bus.',
      'The languages available are English, Spanish, and French.',
      'Showing your tour ticket gets you a discount at museums.',
      'You can listen to information about landmarks through QR codes.',
    ],
  },
  {
    id: '6a2222278d91251beb10f444', type: '일치', ca: '②', mustInclude: '5개의 정류장에서만',
    options: [
      'You can get on and off the bus at only five stops.',
      'Free Wi-Fi and USB ports are available on the bus.',
      'The open-air top level is not available.',
      'Rides are limited to once a day.',
      'The audio guide is provided only in English.',
    ],
  },
  {
    id: '6a2222278d91251beb10f445', type: '일치', ca: '①', mustInclude: '10개의 정류장에서 운행',
    options: [
      'You can take unlimited rides for one day.',
      'Scanning a QR code gets you a discount.',
      'Two languages are available for the audio guide.',
      'Wi-Fi is provided for a fee.',
      'The bus runs through ten stops.',
    ],
  },
  {
    id: '6a2222278d91251beb10f446', type: '일치', ca: '②', mustInclude: '신분증을 제시해야',
    options: [
      'You must show an ID card to get a discount at museums.',
      'The audio guide gives information about landmarks.',
      'USB ports are available only on the top level.',
      'You can only get off at the designated stops, and boarding is not possible.',
      'Chinese is not one of the available languages.',
    ],
  },
  {
    id: '6a2222278d91251beb10f44d', type: '주제', ca: '①', mustInclude: '정기권 구매 방법',
    options: [
      'a guide to a hop-on hop-off city bus tour you can use freely',
      'how to purchase a regular pass for city public transportation',
      'the procedure for applying for free museum admission tickets',
      'a job posting for foreign-language tour guides',
      'the need to introduce eco-friendly electric buses',
    ],
  },
  {
    id: '6a2222278d91251beb10f44e', type: '주제', ca: '②', mustInclude: '성우 모집',
    options: [
      'the historical origins of major tourist attractions in the city',
      'the features and benefits of a city tour bus that passengers control themselves',
      'recruiting voice actors for audio guide recordings',
      'measures to relieve traffic congestion in the city',
      'an accommodation booking service for group tourists',
    ],
  },
  {
    id: '6a2222278d91251beb10f44f', type: '주제', ca: '⑤', mustInclude: '안전 점검 기준',
    options: [
      'etiquette to follow when visiting museums',
      'the development of QR code technology',
      'recommended travel programs for learning foreign languages',
      'safety inspection standards for city tour buses',
      'an introduction to a city tour bus offering free boarding and various conveniences',
    ],
  },
  // ── 28번 (Glass Art Workshop)
  {
    id: '6a2222278d91251beb10f456', type: '불일치', ca: '④', mustInclude: '별도로 청구된다',
    options: [
      'The workshop takes place on the morning of July 12th.',
      'For safety, only adults and children over 12 can participate.',
      'The maximum number of participants is 10.',
      'Tools and materials are charged separately from the participation fee.',
      'Finished artworks must be picked up on another day.',
    ],
  },
  {
    id: '6a2222288d91251beb10f457', type: '불일치', ca: '②', mustInclude: '보호자와 함께라면',
    options: [
      'Participants learn how to heat and shape glass at Spark Studio.',
      'Children aged 12 or under can participate if accompanied by a guardian.',
      'The fee is $60 per person.',
      'You can make one cup, vase, or bowl.',
      'Finished works need 24 hours to cool.',
    ],
  },
  {
    id: '6a2222288d91251beb10f458', type: '불일치', ca: '④', mustInclude: '개수에는 제한이 없다',
    options: [
      'The workshop runs for two hours.',
      'The number of participants is limited to a maximum of 10.',
      'The fee includes all tools and materials.',
      'There is no limit to the number of pieces you can make.',
      'You can sign up at sp*rk2glass.com.',
    ],
  },
  {
    id: '6a2222288d91251beb10f468', type: '일치', ca: '③', mustInclude: '이틀에 걸쳐',
    options: [
      'The workshop takes place over two days.',
      'For safety, children over 12 cannot participate.',
      'The number of participants is limited to a maximum of 10.',
      'Tools and materials are not included in the fee.',
      'You can take your finished artwork home on the same day.',
    ],
  },
  {
    id: '6a2222288d91251beb10f469', type: '일치', ca: '①', mustInclude: '12시간이 걸린다',
    options: [
      'The fee is $60 per person, including all tools and materials.',
      'The workshop runs for two hours in the afternoon.',
      'Participants can make a cup, a vase, and a bowl all together.',
      'Anyone can participate regardless of age.',
      'Artworks take 12 hours to cool.',
    ],
  },
  {
    id: '6a2222288d91251beb10f46a', type: '일치', ca: '②', mustInclude: '성인은 참가할 수 없다',
    options: [
      'The workshop is free of charge.',
      'Artworks need 24 hours to cool, so they must be picked up another day.',
      'There is no limit on the number of participants.',
      'The workshop will be held in August.',
      'Adults cannot participate.',
    ],
  },
  {
    id: '6a2222298d91251beb10f471', type: '주제', ca: '①', mustInclude: '재활용을 통한 환경 보호',
    options: [
      'a guide to a one-day craft workshop on heating and shaping glass',
      'an introduction to the history and development of glass art',
      'glass processing regulations for a safe working environment',
      'an announcement of an exhibition of various glass artworks',
      'an environmental campaign for recycling glass',
    ],
  },
  {
    id: '6a2222298d91251beb10f472', type: '주제', ca: '③', mustInclude: '용암과 유리의 물리적',
    options: [
      'promotion of an online store selling glass products',
      'recruitment for an art education program for children',
      'a notice recruiting participants for a hands-on glass art workshop',
      'a comparative study of the physical properties of lava and glass',
      'an introduction to studio rental services for artists',
    ],
  },
  {
    id: '6a2222298d91251beb10f473', type: '주제', ca: '④', mustInclude: '자원봉사 참가자 모집',
    options: [
      'a professional certificate course for becoming a glass artisan',
      'how to safely store and care for glass products',
      'a notice recruiting community volunteers',
      'an invitation to a workshop where you make your own glass artwork',
      'an explanation of glass art tools and how to use them',
    ],
  },
  // ── 29번 (Discount coupons / Whitehead)
  {
    id: '6a2222298d91251beb10f47a', type: '불일치', ca: '③', mustInclude: '훨씬 적은 고객 반응',
    options: [
      'Whitehead asserted that civilization advances by extending the number of operations we can perform without thinking.',
      'Discount coupons allow consumers to assume they will receive a reduced price by presenting the coupon.',
      'Coupons that offered no savings due to a printing error produced far less customer response than error-free ones.',
      'We expect discount coupons to do double duty.',
      'We expect coupons to save us not only money but also time and mental energy.',
    ],
  },
  {
    id: '6a2222298d91251beb10f47b', type: '불일치', ca: '③', mustInclude: '유일하게 기대한다',
    options: [
      'Whitehead is introduced as a renowned British philosopher.',
      'The example of the misprinted coupons comes from the experience of an automobile-tire company.',
      'We expect coupons only to save us money.',
      'Today, the first advantage is needed to handle pocketbook strain.',
      'The second advantage is needed to handle brain strain, which is potentially more important.',
    ],
  },
  {
    id: '6a2222298d91251beb10f47c', type: '불일치', ca: '④', mustInclude: '아무런 절약도 제공하지 못했다',
    options: [
      'Whitehead explained the advance of civilization in connection with extending the number of operations.',
      "The discount coupon is presented as an example of an 'advance' offered to civilization.",
      'How mechanically we operate on that assumption is illustrated by the experience of an automobile-tire company.',
      'The error-free coupons offered no savings to recipients.',
      'Brain strain is considered potentially more important than pocketbook strain.',
    ],
  },
  {
    id: '6a22222a8d91251beb10f48c', type: '일치', ca: '①', mustInclude: '정가대로 구매하도록',
    options: [
      'Alfred North Whitehead asserted that civilization advances by extending the number of operations we can perform without thinking about them.',
      'Discount coupons are a tool that leads consumers to buy at full price.',
      'Coupons that offered no savings due to a printing error got little customer response.',
      'We expect discount coupons to do only one duty: saving money.',
      'Today we only need the advantage of handling pocketbook strain.',
    ],
  },
  {
    id: '6a22222a8d91251beb10f48d', type: '일치', ca: '②', mustInclude: '꼼꼼히 따져 본다',
    options: [
      'Whitehead believed civilization develops only when we think deeply about every operation.',
      'Coupons that offered no savings because of a printing error produced just as much customer response as error-free coupons.',
      'Discount coupons turned out not to save consumers any money.',
      'The tire company case shows that consumers examine coupons carefully.',
      'Brain strain is considered less important than pocketbook strain.',
    ],
  },
  {
    id: '6a22222a8d91251beb10f48e', type: '일치', ca: '③', mustInclude: '무관한 내용이다',
    options: [
      "The tire company's coupons got no customer response because of the printing error.",
      "Whitehead's claim has nothing to do with the example of discount coupons.",
      'We expect discount coupons to save us not only money but also the time and mental energy needed to think about how to do it.',
      'Consumers assume they will not receive a reduced price even when presenting a coupon.',
      'The writer concludes that brain strain is less important than pocketbook strain.',
    ],
  },
  {
    id: '6a22222a8d91251beb10f495', type: '주제', ca: '①', mustInclude: '소비자 신뢰에 미치는 부정적',
    options: [
      'automatic responses to coupons driven by the expectation of saving mental effort',
      'the negative effects of printing errors on consumer trust and how to address them',
      'the dangers of uncritical consumption habits that hinder the progress of civilization',
      'marketing strategies in which price discounts increase corporate sales',
      'the process by which consumers gather information for rational judgment',
    ],
  },
  {
    id: '6a22222a8d91251beb10f496', type: '주제', ca: '③', mustInclude: '무사고 운전',
    options: [
      'ways to make coupon mailing more efficient in the tire industry',
      "the importance of consumers' information processing for safe driving",
      'consumer behavior automated by the expectation that coupons save both money and thinking',
      'the influence of philosophical thought on modern marketing techniques',
      'changes that advances in printing technology brought to advertising',
    ],
  },
  {
    id: '6a22222b8d91251beb10f497', type: '주제', ca: '④', mustInclude: '디지털 결제 수단',
    options: [
      'consumer loyalty that grows with the size of coupon discounts',
      'the spread of digital payment as a sign of advancing civilization',
      'the need to regulate deceptive advertising that misleads consumers',
      'the human tendency to reduce brain strain by extending operations performed without thinking',
      'statistical techniques companies use to measure customer response',
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
