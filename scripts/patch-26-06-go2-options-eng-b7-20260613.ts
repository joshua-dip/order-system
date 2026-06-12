/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 7: 36·37·38번 27건 (2026-06-13).
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b7-20260613.ts [--apply]
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
  // ── 36번 (Leisure of early ancestors)
  {
    id: '6a2222358d91251beb10f576', type: '불일치', ca: '③', mustInclude: '더 강한 근력의 발달이었다',
    options: [
      'For most animals, the struggle to survive takes up all their time.',
      'Only very young animals have enough surplus energy to engage in lively play.',
      'The secret of early ancestors’ success was the development of greater muscular strength.',
      'Early ancestors used brain, not brawn, to kill their prey.',
      'Early ancestors were already enjoying some degree of affluence before turning to farming.',
    ],
  },
  {
    id: '6a2222358d91251beb10f577', type: '불일치', ca: '④', mustInclude: '사냥 효율이 거의 변하지 않았다',
    options: [
      'Finding food and avoiding predators uses up all of animals’ energy.',
      'Very young animals engage in play under the protection of their parents.',
      'The constant search for food would have put heavy demands on early ancestors.',
      'Early ancestors evolved but their hunting efficiency hardly changed.',
      'At particular times, the prey was sufficiently plentiful.',
    ],
  },
  {
    id: '6a2222358d91251beb10f578', type: '불일치', ca: '③', mustInclude: '전혀 여유 시간을 갖지 못했다',
    options: [
      'If animals have any time to spare, they spend it resting or sleeping.',
      'That the struggle to survive takes up time was also true for early ancestors.',
      'Early ancestors never had any spare time throughout the hunting era.',
      'The ancestors’ hunting techniques were sufficiently advanced.',
      'The ancestors experienced a remarkable degree of prosperity.',
    ],
  },
  {
    id: '6a2222368d91251beb10f588', type: '일치', ca: '①', mustInclude: '강한 근력의 발달이었다',
    options: [
      'For most animals, the struggle to survive takes up all their time.',
      'Animals spend any spare time they have on play.',
      'Young animals play lively even without their parents’ protection.',
      'The secret of early ancestors’ success was the development of greater muscular strength.',
      'Early ancestors began to enjoy affluence only after turning to farming.',
    ],
  },
  {
    id: '6a2222368d91251beb10f589', type: '일치', ca: '②', mustInclude: '두뇌를 사용했다',
    options: [
      'Most animals have enough surplus energy for play.',
      'Early ancestors used brain, not brawn, when killing their prey.',
      'Early ancestors’ hunting efficiency declined as they evolved.',
      'Prey was always scarce in every region.',
      'Animals spend almost no energy avoiding predators.',
    ],
  },
  {
    id: '6a2222368d91251beb10f58a', type: '일치', ca: '③', mustInclude: '부담을 주지 않았다',
    options: [
      'The constant search for food did not burden early ancestors.',
      'Animals spend spare time on lively play.',
      'The secret of early ancestors’ success was the development of much greater intelligence.',
      'Early ancestors had no spare time throughout the hunting era.',
      'Very young animals do not receive their parents’ protection.',
    ],
  },
  {
    id: '6a2222368d91251beb10f591', type: '주제', ca: '①', mustInclude: '에너지를 분배하는 다양한 방식',
    options: [
      'the emergence of spare time that intelligence brought to human ancestors',
      'the various ways animals distribute their energy for survival',
      'the positive effect of young animals’ play on brain development',
      'the influence of the shift to farming society on human civilization',
      'animals’ elaborate survival strategies for avoiding predators',
    ],
  },
  {
    id: '6a2222368d91251beb10f592', type: '주제', ca: '③', mustInclude: '본질적인 차이점',
    options: [
      'the constant food shortage that human ancestors faced',
      'the amount of energy wild animals need for reproduction and migration',
      'human ancestors who gained affluence and leisure through developing intelligence',
      'the essential differences between hunting skills and farming skills',
      'the traits of young animals growing under their parents’ protection',
    ],
  },
  {
    id: '6a2222368d91251beb10f593', type: '주제', ca: '②', mustInclude: '수면 시간에 미치는 영향',
    options: [
      'the effect of the struggle for survival on animals’ sleeping time',
      'the leisure human ancestors gained as improved hunting efficiency came from intelligence',
      'the process by which human ancestors came to use tools instead of muscle',
      'changes in the distribution of wild prey by season and region',
      'how animals develop social skills through play',
    ],
  },
  // ── 37번 (Freeze response and language)
  {
    id: '6a2222378d91251beb10f59a', type: '불일치', ca: '④', mustInclude: '동결 규칙을 없애고 언어의 진화만을',
    options: [
      'Startle responses maximize our ability to avoid detection.',
      'The creation of sound can give away our location to a potential predator.',
      'The freeze response results in the inhibition of language in highly stressful situations.',
      'Natural selection eliminated the freeze rule and promoted only the evolution of language.',
      'Interference with the development of neural networks can result in chronic stress.',
    ],
  },
  {
    id: '6a2222378d91251beb10f59b', type: '불일치', ca: '⑤', mustInclude: '위치를 항상 감춰 준다',
    options: [
      'Startle responses maximize our ability to locate the source of danger.',
      'The freeze response inhibits language in highly traumatic situations.',
      'When the threat passes, we relax and begin to find our voices again.',
      'Interference with the development of neural networks can even result in mental illness.',
      'Sophisticated language always hides our location from predators.',
    ],
  },
  {
    id: '6a2222378d91251beb10f59c', type: '불일치', ca: '⑤', mustInclude: '언어 능력을 영구적으로 향상시킨다',
    options: [
      'Startle responses maximize our ability to prepare to fight or flee.',
      'In highly stressful situations, the freeze response inhibits language.',
      'When the threat passes, we may even laugh at our own reactions.',
      'If experiences keep the brain in a constant state of fear, it can lead to chronic stress.',
      'The freeze response permanently improves language ability in all situations.',
    ],
  },
  {
    id: '6a2222378d91251beb10f5ac', type: '일치', ca: '①', mustInclude: '언어 사용을 촉진한다',
    options: [
      'Startle responses maximize our ability to detect and respond to danger.',
      'The freeze response promotes the use of language in stressful situations.',
      'Natural selection inhibited the evolution of language and eliminated the freeze rule.',
      'Even after the threat passes, we never regain our voices.',
      'The creation of sound perfectly hides our location from predators.',
    ],
  },
  {
    id: '6a2222378d91251beb10f5ad', type: '일치', ca: '③', mustInclude: '호흡이 빨라지고 움직임이 격렬해진다',
    options: [
      'When startled, breathing speeds up and movements become violent.',
      'Language has become sophisticated and no longer reveals our location to predators.',
      'When the threat passes, we relax and find our voices again.',
      'The freeze rule disappeared in the course of natural selection.',
      'Proper development of neural networks leads to chronic stress.',
    ],
  },
  {
    id: '6a2222388d91251beb10f5ae', type: '일치', ca: '①', mustInclude: '언어의 억제를 초래한다',
    options: [
      'The freeze response results in the inhibition of language in highly stressful situations.',
      'Natural selection eliminated both the evolution of language and the freeze rule.',
      'When startled, we greatly increase our breathing to prepare for the threat.',
      'Making sound hides our location from predators and keeps us safe.',
      'Even if the brain is in a constant state of fear, it is unrelated to mental illness.',
    ],
  },
  {
    id: '6a2222388d91251beb10f5b5', type: '주제', ca: '①', mustInclude: '다른 동물의 의사소통보다 정교하게',
    options: [
      'the evolutionary origin of the freeze response that inhibits language under threat and its side effects',
      'why human language developed more elaborately than other animals’ communication',
      'methods of neural network training to effectively relieve chronic stress',
      'the various camouflage strategies animals developed to avoid predators',
      'the development of neurological tests for diagnosing post-traumatic stress disorder',
    ],
  },
  {
    id: '6a2222388d91251beb10f5b6', type: '주제', ca: '③', mustInclude: '웃음으로 긴장을 해소',
    options: [
      'the decisive factors by which language ability contributed to human survival',
      'the psychological effect of releasing tension through laughter when startled',
      'the evolution of the freeze response that inhibits sound under threat and its danger when prolonged',
      'the specific mechanism by which natural selection promotes the integration of neural networks',
      'the auditory ability of predators to track the location of prey',
    ],
  },
  {
    id: '6a2222388d91251beb10f5b7', type: '주제', ca: '④', mustInclude: '언어 영역을 영구히 손상',
    options: [
      'the process by which traumatic experiences permanently damage the brain’s language areas',
      'the various sensory organs humans developed to detect danger',
      'training to stay calm by controlling breathing in stressful situations',
      'the freeze response conserved for survival and the mental problems it causes when it becomes chronic',
      'the biggest feature that distinguishes language from animal communication',
    ],
  },
  // ── 38번 (Violent video games and empathy)
  {
    id: '6a2222388d91251beb10f5be', type: '불일치', ca: '③', mustInclude: '거의 연구가 이루어지지 않았다',
    options: [
      'Video gaming is one of the most studied technologies with regard to empathy.',
      'There have been longstanding concerns about the impact of violent video games on youth.',
      'Little research has been conducted on the topic over the last two or three decades.',
      'A normal reaction to witnessing violent events includes feeling negative emotions.',
      'Desensitization can occur with repeated exposure to violent events.',
    ],
  },
  {
    id: '6a2222388d91251beb10f5bf', type: '불일치', ca: '④', mustInclude: '오히려 더 강화시켜 공감을 증가',
    options: [
      'Scientists have formulated credible explanations of how video gaming could affect empathy.',
      'A normal reaction to witnessing violence includes physiological arousal connected to fear or disgust.',
      'The blunting of the normal reaction is known as desensitization.',
      'Repeated exposure rather strengthens the normal reaction and increases empathy.',
      'Diminished emotional responses to violence can interfere with the ability to sympathize with others.',
    ],
  },
  {
    id: '6a2222388d91251beb10f5c0', type: '불일치', ca: '①', mustInclude: '비교적 최근에야 처음 제기되었다',
    options: [
      'Concerns about the impact of violent video games on youth were first raised only recently.',
      'Video gaming is one of the most studied technologies with regard to empathy.',
      'A normal, healthy reaction to witnessing violent events includes feeling negative emotions.',
      'The next step of desensitization is having diminished emotional responses to violence.',
      'Considerable research shows a link between extensive violent video gaming and reduced empathy.',
    ],
  },
  {
    id: '6a2222398d91251beb10f5d0', type: '일치', ca: '①', mustInclude: '최근에야 생겨났다',
    options: [
      'Video gaming is one of the most studied technologies with regard to empathy.',
      'Concerns about the impact of violent video games on youth arose only recently.',
      'Feeling negative emotions when witnessing violent events is an abnormal reaction.',
      'Repeated exposure to violence makes the normal reaction more intense.',
      'Studies show no association at all between violent video games and empathy.',
    ],
  },
  {
    id: '6a2222398d91251beb10f5d1', type: '일치', ca: '②', mustInclude: '신뢰할 만한 설명을 내놓지 못했다',
    options: [
      'Scientists have failed to formulate credible explanations of how video games affect empathy.',
      'The physiological arousal when witnessing violent events is connected to fear or disgust.',
      'Desensitization refers to a phenomenon in which reactions to violence become increasingly sensitive.',
      'Research on the topic has been conducted intensively only in the last year or two.',
      'Diminished emotional responses improve the ability to sympathize with others.',
    ],
  },
  {
    id: '6a2222398d91251beb10f5d2', type: '일치', ca: '④', mustInclude: '긍정적 감정을 느끼는 것이다',
    options: [
      'The normal reaction to violent events is to feel positive emotions.',
      'The impact of video game violence has been neither measured nor documented.',
      'There were no concerns about the impact of video games on youth.',
      'Repeated exposure to violence can blunt the normal reaction.',
      'Considerable research shows that violent video games enhance empathy.',
    ],
  },
  {
    id: '6a22223a8d91251beb10f5d9', type: '주제', ca: '①', mustInclude: '긍정적 경제 효과',
    options: [
      'the process by which repeated exposure to violent video games weakens empathy',
      'the positive economic effects the video game industry had on youth culture',
      'the evolutionary origin of the physiological arousal when witnessing violent events',
      'effective ways to use video games to improve empathy',
      'the role of parents in preventing youth game addiction',
    ],
  },
  {
    id: '6a22223a8d91251beb10f5da', type: '주제', ca: '②', mustInclude: '인지 발달에 미치는 학습 효과',
    options: [
      'the learning effects of video games on the cognitive development of youth',
      'the link between desensitization from violent game exposure and reduced empathy',
      'the development of scientific research methods for measuring game violence',
      'the potential of virtual reality therapy to reduce negative emotions',
      'the mechanism of forming social bonds through video games',
    ],
  },
  {
    id: '6a22223a8d91251beb10f5db', type: '주제', ca: '⑤', mustInclude: '이용 시간 규제를 둘러싼',
    options: [
      'the social debate over regulating youth game-playing time',
      'the effect of game design on a player’s level of immersion',
      'the factors behind individual differences in fear and disgust reactions to violence',
      'the ethical responsibility of the game industry and the limits of the age-rating system',
      'the mechanism by which repeated experience of violent video games lowers empathy',
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
