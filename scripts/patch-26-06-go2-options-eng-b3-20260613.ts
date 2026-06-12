/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 3: 24·25·26번 27건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b3-20260613.ts [--apply]
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
  // ── 24번 (Starlight)
  {
    id: '6a22221d8d91251beb10f3c6', type: '불일치', ca: '③', mustInclude: '더 가까운 과거만',
    options: [
      'The light from even our nearest stellar neighbour takes four years to reach us.',
      'Looking at the stars is looking back in time.',
      'The further we collect light from, the more recent the past we can look at.',
      'Betelgeuse is a bright star glowing in the Orion constellation.',
      "Betelgeuse's reddish glow started its journey to Earth in the Middle Ages.",
    ],
  },
  {
    id: '6a22221d8d91251beb10f3c7', type: '불일치', ca: '④', mustInclude: '어떤 세대의 인간에게도 낯선',
    options: [
      'Looking at Betelgeuse winds time back more than six hundred years.',
      "The stars in Orion's belt are even further away than Betelgeuse.",
      "The light of the stars in Orion's belt has travelled at least 1,000 years to reach us.",
      "The light of the stars in Orion's belt is unfamiliar to any generation of humans.",
      'We can see the more distant parts of the universe as they were in the past.',
    ],
  },
  {
    id: '6a22221d8d91251beb10f3c8', type: '불일치', ca: '③', mustInclude: '즉시 도달한다',
    options: [
      'Through starlight, we can see parts of space as they were many years ago.',
      'We have a chance of understanding the history of the universe.',
      'The light from our nearest star reaches us instantly.',
      'Betelgeuse is a star glowing in the Orion constellation.',
      'Betelgeuse gives off a reddish glow.',
    ],
  },
  {
    id: '6a22221e8d91251beb10f3d8', type: '일치', ca: '①', mustInclude: '현대에 지구로 향하는 여정',
    options: [
      'The light from even our nearest star takes four years to reach us.',
      'When we look at the stars, we see them as they are at present.',
      'The closer we collect light from, the further back in time we can look.',
      "Betelgeuse's reddish glow began its journey to Earth in modern times.",
      "The stars in Orion's belt are closer to us than Betelgeuse.",
    ],
  },
  {
    id: '6a22221e8d91251beb10f3d9', type: '일치', ca: '②', mustInclude: '미래를 내다보는 행위',
    options: [
      'Looking at starlight is an act of looking into the future.',
      'Betelgeuse is a bright star glowing in the Orion constellation.',
      "The light of the stars in Orion's belt travelled 100 years to reach us.",
      'The light from our nearest star reaches us immediately.',
      'Looking at Betelgeuse winds time back 60 years.',
    ],
  },
  {
    id: '6a22221e8d91251beb10f3da', type: '일치', ca: '③', mustInclude: '푸른색을 띤다',
    options: [
      'Betelgeuse gives off a bluish glow.',
      'We cannot see any part of the universe as it was in the past.',
      'We have a chance of understanding the history of the universe because we can see its more distant parts as they were in the past.',
      "The light of the stars in Orion's belt is familiar to no generation of humans.",
      'Parts of the universe can only be observed as they are at present.',
    ],
  },
  {
    id: '6a22221e8d91251beb10f3e1', type: '주제', ca: '①', mustInclude: '고대 항해술',
    options: [
      "looking into the universe's past through observing starlight",
      'astronomical methods for accurately measuring the distance to stars',
      'the decisive influence of the speed of light on modern physics',
      'the development of ancient navigation using the Orion constellation',
      'innovations the invention of the telescope brought to astronomy',
    ],
  },
  {
    id: '6a22221e8d91251beb10f3e2', type: '주제', ca: '③', mustInclude: '우주 팽창으로',
    options: [
      'myths and legends behind the constellations in the night sky',
      "the scientific principle behind Betelgeuse's reddish glow",
      'the past history of the universe delivered by light from distant stars',
      'changes in the distances between stars caused by cosmic expansion',
      'the cultural background of how humans became familiar with starlight',
    ],
  },
  {
    id: '6a22221f8d91251beb10f3e3', type: '주제', ca: '①', mustInclude: '빛 공해',
    options: [
      'the distant past of the universe revealed by observing starlight',
      "how to estimate a star's age from the brightness of its light",
      'medieval records of astronomical observation and their significance',
      'seasonal changes in the position of the Orion constellation',
      'negative effects of light pollution on modern stargazing',
    ],
  },
  // ── 25번 (Population chart)
  {
    id: '6a22221f8d91251beb10f3ea', type: '불일치', ca: '③', mustInclude: '4퍼센트포인트 더 낮았다',
    options: [
      'The graph shows the proportions of people aged over 65 and under 15 in five selected regions in 2024.',
      'North America was the only region where the proportions of people over 65 and under 15 were identical, both at 18%.',
      'In Europe, the proportion of people over 65 was 4 percentage points lower than that of those under 15.',
      'In Oceania, the proportion of people under 15 was higher than that in Europe.',
      'Compared to the other regions, Sub-Saharan Africa showed the greatest proportion of people under 15.',
    ],
  },
  {
    id: '6a22221f8d91251beb10f3eb', type: '불일치', ca: '④', mustInclude: '오세아니아에서의 그것보다 더 컸다',
    options: [
      'North America was the only region where the proportions of people over 65 and under 15 were identical.',
      'In Europe, the proportion of people over 65 exceeded that of those under 15 by 4 percentage points.',
      'In Oceania, the proportion of people over 65 was lower than that in Europe.',
      'The gap between the proportions of the selected age groups in Central Asia was larger than that in Oceania.',
      'Compared to the other regions, Sub-Saharan Africa showed the greatest proportion of people under 15.',
    ],
  },
  {
    id: '6a22221f8d91251beb10f3ec', type: '불일치', ca: '⑤', mustInclude: '가장 작은 15세 미만',
    options: [
      'The graph shows the proportions of people aged over 65 and under 15 in five selected regions in 2024.',
      'In North America, the proportions of people over 65 and under 15 were both 18%.',
      'In Europe, the proportion of people over 65 exceeded that of those under 15 by 4 percentage points.',
      'In Oceania, the proportion of people under 15 was higher than that in Europe.',
      'Compared to the other regions, Sub-Saharan Africa showed the smallest proportion of people under 15.',
    ],
  },
  {
    id: '6a2222208d91251beb10f3fc', type: '일치', ca: '①', mustInclude: '비율보다 높았던 유일한 지역',
    options: [
      'The graph shows the proportions of people aged over 65 and under 15 in five regions in 2024.',
      'North America was the only region where the proportion of people over 65 was higher than that of those under 15.',
      'In Europe, the proportion of people under 15 exceeded that of those over 65 by 4 percentage points.',
      'In Oceania, the proportion of people over 65 was higher than that in Europe.',
      'The gap between the age groups in Central Asia was larger than that in Oceania.',
    ],
  },
  {
    id: '6a2222208d91251beb10f3fd', type: '일치', ca: '②', mustInclude: '각각 다른 값을 보였다',
    options: [
      'In North America, the two age groups showed different proportions.',
      'In North America, the proportions of the two age groups were both 18%.',
      'In Europe, the proportion of people under 15 was higher than that of those over 65.',
      'In Oceania, the proportion of people under 15 was lower than that in Europe.',
      'Sub-Saharan Africa was the region with the lowest proportion of people under 15.',
    ],
  },
  {
    id: '6a2222208d91251beb10f3fe', type: '일치', ca: '③', mustInclude: '북아메리카를 제외한 모든 지역',
    options: [
      'Sub-Saharan Africa had the lowest proportion of people under 15 among the regions.',
      'The gap between the age groups in Central Asia was the same as that in Oceania.',
      'In Oceania, the proportion of people under 15 was higher than that in Europe.',
      'In Europe, the proportion of people over 65 was 4 percentage points lower than that of those under 15.',
      'In every region except North America, the proportions of the two age groups were identical.',
    ],
  },
  {
    id: '6a2222208d91251beb10f405', type: '주제', ca: '①', mustInclude: '의료 정책의 변화',
    options: [
      'a comparison of the proportions of people over 65 and under 15 across five regions',
      'the root causes of accelerating population aging worldwide',
      'the economic effects of declining birth rates by region',
      'changes in healthcare policy due to the growing population over 65',
      'national efforts to prevent the decline of the youth population',
    ],
  },
  {
    id: '6a2222208d91251beb10f406', type: '주제', ca: '③', mustInclude: '사하라 이남 아프리카의 높은 출산율',
    options: [
      'differences in the social roles of elderly and young populations',
      'how to interpret demographic data accurately',
      'the distribution of population proportions by age group in five regions in 2024',
      'the background of high birth rates in Sub-Saharan Africa',
      'similarities in the population structures of North America and Europe',
    ],
  },
  {
    id: '6a2222208d91251beb10f407', type: '주제', ca: '②', mustInclude: '복지 제도 개선',
    options: [
      'a comparison of population policies in developed and developing countries',
      'the regional proportions of people over 65 and under 15 in 2024',
      'trends in age-group population proportions over time',
      'improving welfare systems to prepare for population aging',
      'the effects of migration between regions on age structures',
    ],
  },
  // ── 26번 (Jacob Lawrence)
  {
    id: '6a2222248d91251beb10f40e', type: '불일치', ca: '⑤', mustInclude: '모두 남아 있다',
    options: [
      'He was born in Atlantic City in 1917.',
      'He moved to Harlem at the age of 13.',
      'He used bright colors and simplified shapes in his paintings.',
      'The Migration Series brought him national recognition.',
      'All the paintings he produced during World War II have survived.',
    ],
  },
  {
    id: '6a2222248d91251beb10f40f', type: '불일치', ca: '⑤', mustInclude: '완전히 그만두었다',
    options: [
      'He was an American painter who depicted African-American history and daily life.',
      "He studied art at Utopia Children's Center.",
      'He taught at the University of Washington for 16 years.',
      'He received honorary degrees from several universities, including Harvard.',
      'He completely gave up painting several years before his death.',
    ],
  },
  {
    id: '6a2222248d91251beb10f410', type: '불일치', ca: '④', mustInclude: '단 한 곳의 대학에서만',
    options: [
      'He moved to Harlem at the age of 13.',
      'The Migration Series is widely regarded as his masterpiece.',
      'He served in the U.S. Coast Guard during World War II.',
      'He received an honorary degree from only one university.',
      'Until a few weeks before his death, he explored the lives of African-Americans through his painting.',
    ],
  },
  {
    id: '6a2222258d91251beb10f420', type: '일치', ca: '①', mustInclude: '평생 그곳에서 작품 활동',
    options: [
      "He moved to Harlem at 13 and studied art at Utopia Children's Center.",
      'He was born in Atlantic City and worked there all his life.',
      'He mainly used dark colors and complex shapes in his paintings.',
      'Most of the paintings he produced during World War II were well preserved.',
      'He taught students at the University of Washington for six years.',
    ],
  },
  {
    id: '6a2222258d91251beb10f421', type: '일치', ca: '②', mustInclude: '최초 실패작',
    options: [
      'The Migration Series is regarded as his first failure.',
      'He served in the U.S. Coast Guard during World War II.',
      'He stopped creating works long before his death.',
      'He received an honorary degree only from Harvard.',
      'He was better known for landscape paintings than for African-American history.',
    ],
  },
  {
    id: '6a2222258d91251beb10f422', type: '일치', ca: '③', mustInclude: '독학으로만',
    options: [
      'He was born in Harlem in 1917.',
      'He learned art entirely by teaching himself.',
      'The Migration Series brought him national recognition.',
      'He never received an honorary degree.',
      'He painted nothing at all during his military service.',
    ],
  },
  {
    id: '6a2222258d91251beb10f429', type: '주제', ca: '①', mustInclude: '예술 후원 활동',
    options: [
      'the life of Jacob Lawrence, a painter of African-American life',
      'the influence of World War II on American art',
      'the history of the Black art movement that developed in Harlem',
      "what honorary degrees mean for a painter's career",
      "the U.S. Coast Guard's patronage of the arts",
    ],
  },
  {
    id: '6a2222258d91251beb10f42a', type: '주제', ca: '②', mustInclude: '복원 노력',
    options: [
      'changes in the use of color in 20th-century American painting',
      'the artistic life and achievements of the painter Jacob Lawrence',
      'features of the art education program at the University of Washington',
      'efforts to restore artworks lost during the war',
      "the art education program of Utopia Children's Center",
    ],
  },
  {
    id: '6a2222258d91251beb10f42b', type: '주제', ca: '③', mustInclude: '명예 학위 수여 기준',
    options: [
      'exhibition trends of American museums featuring Black history',
      'the artistic worlds of painters who served in World War II',
      'Jacob Lawrence, a painter who depicted African-American life throughout his career',
      'the criteria universities such as Harvard use to award honorary degrees',
      'how migration to Harlem changed African-American culture',
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
