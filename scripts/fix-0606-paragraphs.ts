import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const TWO_MIN_BASE = `Doing necessary tasks and forming new habits are two things people constantly put off. However, neither one is difficult or time-consuming — people just avoid doing them. The two-minute rule solves this problem by making it easier to get started. When you have a task to complete, imagine how long it will take. If you think it will take less than two minutes, then do it right away. And when you're having trouble starting a new habit, focus on an activity that takes less than two minutes. For example, most good writers have a habit of writing for at least an hour each day. To start this kind of habit, however, you just need to take a minute or two each day to write a sentence. Soon you will get in the habit of writing for an hour at a time.`;

const LIONFISH_BASE = `Lionfish are common in aquariums because of their interesting color patterns and their large, wavy fins. While young lionfish are about two centimeters long, adults grow to 15 times this length. The habitat of lionfish is spreading, but their original home was a stretch of ocean between Australia and South Korea. They feed on shrimp and smaller fish, and are known for their big appetites. In fact, lionfish have stomachs that can increase in size by as much as 30 times when full. They also breed rapidly, with female lionfish releasing about 2 million eggs throughout the year. Lionfish defend themselves with venomous spines. If a lionfish stings a human, the person experiences sweating, pain, and sometimes even difficulty breathing and paralysis.`;

const PATCHES: { id: string; paragraph: string; question: string; explanation: string }[] = [
  // ── 빈칸 (Two-Minute Rule) ─────────────────────────────────────────
  {
    id: '69e1211c45fcceb0f02f49f0',
    paragraph: TWO_MIN_BASE.replace('making it easier to get started', 'making it ________ to get started'),
    question: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
    explanation:
      '① easier가 정답. 빈칸은 "The two-minute rule solves this problem by making it ________ to get started"로, 2분 규칙이 시작을 어떻게 만드는지 묻습니다. 글 전체가 미루기 극복을 위해 2분 이내 작업은 즉시 하고 새 습관도 2분 활동으로 시작한다는 내용이므로 \'더 쉽게(easier)\' 시작하는 것이 자연스럽습니다. ②harder(더 어렵게), ③slower(더 느리게), ④useless(무용하게), ⑤dangerous(위험하게)는 2분 규칙의 긍정적 효과와 반대되거나 무관합니다.',
  },

  // ── 빈칸 (Lionfish) ────────────────────────────────────────────────
  {
    id: '69e1213a45fcceb0f02f49f7',
    paragraph: LIONFISH_BASE.replace('venomous spines', '________ spines'),
    question: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
    explanation:
      '① venomous가 정답. 빈칸은 "Lionfish defend themselves with ________ spines"로, 사자물고기가 어떤 가시로 자신을 방어하는지 묻습니다. 이어지는 문장에서 사자물고기에 쏘이면 발한·통증·호흡 곤란·마비까지 겪는다고 했으므로, 가시가 \'독이 있는(venomous)\'임을 확인할 수 있습니다. ②colorful(화려한), ③long(긴), ④thin(얇은), ⑤smooth(매끄러운)는 이 문맥과 맞지 않습니다.',
  },

  // ── 삽입 (Two-Minute Rule) ────────────────────────────────────────
  {
    id: '69e1212b45fcceb0f02f49f4',
    paragraph: `Doing necessary tasks and forming new habits are two things people constantly put off. ( ① ) However, neither one is difficult or time-consuming — people just avoid doing them. ( ② ) The two-minute rule solves this problem by making it easier to get started. ( ③ ) When you have a task to complete, imagine how long it will take. If you think it will take less than two minutes, then do it right away. ( ④ ) And when you're having trouble starting a new habit, focus on an activity that takes less than two minutes. ( ⑤ ) For example, most good writers have a habit of writing for at least an hour each day. To start this kind of habit, however, you just need to take a minute or two each day to write a sentence. Soon you will get in the habit of writing for an hour at a time.`,
    question: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\nThis small step removes the mental barrier of starting and helps you build momentum.`,
    explanation:
      '④가 정답. 삽입 문장 "This small step removes the mental barrier of starting and helps you build momentum."에서 \'This small step\'은 ③~④ 사이에 나온 "do it right away(즉시 하라)"는 행동을 가리킵니다. ④ 위치에 삽입하면 \'즉시 하라 → 이 작은 행동이 시작의 심리적 장벽을 제거하고 추진력을 쌓는다 → 새 습관 시작 어려울 때 2분 활동에 집중하라\'는 논리 흐름이 자연스럽게 이어집니다.',
  },

  // ── 삽입 (Lionfish) ───────────────────────────────────────────────
  {
    id: '69e1214f45fcceb0f02f49fb',
    paragraph: `Lionfish are common in aquariums because of their interesting color patterns and their large, wavy fins. ( ① ) While young lionfish are about two centimeters long, adults grow to 15 times this length. ( ② ) The habitat of lionfish is spreading, but their original home was a stretch of ocean between Australia and South Korea. ( ③ ) They feed on shrimp and smaller fish, and are known for their big appetites. In fact, lionfish have stomachs that can increase in size by as much as 30 times when full. ( ④ ) They also breed rapidly, with female lionfish releasing about 2 million eggs throughout the year. ( ⑤ ) Lionfish defend themselves with venomous spines. If a lionfish stings a human, the person experiences sweating, pain, and sometimes even difficulty breathing and paralysis.`,
    question: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\nThis rapid reproduction rate has contributed to their growing presence in non-native ocean regions.`,
    explanation:
      '⑤가 정답. 삽입 문장 "This rapid reproduction rate has contributed to their growing presence in non-native ocean regions."에서 \'This rapid reproduction rate\'는 ④~⑤ 위치의 "They also breed rapidly, with female lionfish releasing about 2 million eggs throughout the year"에서 언급된 빠른 번식률을 가리킵니다. ⑤에 삽입하면 \'빠르게 번식한다 → 이 빠른 번식률이 비원산지 바다에서의 개체 수 증가에 기여했다 → 독침으로 자신을 방어한다\'는 논리 흐름이 이어집니다.',
  },

  // ── 순서 (Two-Minute Rule) ────────────────────────────────────────
  {
    id: '69e1212245fcceb0f02f49f2',
    paragraph: `Doing necessary tasks and forming new habits are two things people constantly put off. However, neither one is difficult or time-consuming — people just avoid doing them.`,
    question: `주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?\n\n(A) If you think it will take less than two minutes, then do it right away. And when you're having trouble starting a new habit, focus on an activity that takes less than two minutes.\n(B) For example, most good writers have a habit of writing for at least an hour each day. To start this kind of habit, however, you just need to take a minute or two each day to write a sentence. Soon you will get in the habit of writing for an hour at a time.\n(C) The two-minute rule solves this problem by making it easier to get started. When you have a task to complete, imagine how long it will take.`,
    explanation:
      '④ (C)-(A)-(B)가 정답. 주어진 글에서 미루기와 습관 형성의 어려움을 제시한 뒤, (C)에서 "The two-minute rule solves this problem"으로 해결책을 소개하며 과제 시간을 상상하라 하고, (A)에서 2분 미만이면 즉시 실행 + 새 습관은 2분 활동으로 시작이라는 구체적 실천 방법을 제시하며, (B)에서 좋은 작가의 글쓰기 예시로 마무리합니다.\n논리 흐름 요약: 문제 제시 → 해결책·도구 소개 → 구체적 실천 → 예시·결론',
  },

  // ── 순서 (Lionfish) ───────────────────────────────────────────────
  {
    id: '69e1214545fcceb0f02f49f9',
    paragraph: `Lionfish are common in aquariums because of their interesting color patterns and their large, wavy fins.`,
    question: `주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?\n\n(A) They also breed rapidly, with female lionfish releasing about 2 million eggs throughout the year. Lionfish defend themselves with venomous spines. If a lionfish stings a human, the person experiences sweating, pain, and sometimes even difficulty breathing and paralysis.\n(B) While young lionfish are about two centimeters long, adults grow to 15 times this length. The habitat of lionfish is spreading, but their original home was a stretch of ocean between Australia and South Korea.\n(C) They feed on shrimp and smaller fish, and are known for their big appetites. In fact, lionfish have stomachs that can increase in size by as much as 30 times when full.`,
    explanation:
      '③ (B)-(C)-(A)가 정답. 주어진 글에서 사자물고기의 외모(색채·지느러미)를 소개한 뒤, (B)에서 크기 성장과 서식지·원산지를 설명하고, (C)에서 식성·큰 식욕·위장 크기를 이어받으며, (A)에서 빠른 번식과 독침·인간에 대한 위험으로 마무리합니다.\n논리 흐름 요약: 외모 → 크기·서식지 → 식성 → 번식·방어·위험',
  },

  // ── 어법 (Two-Minute Rule) ─────────────────────────────────────────
  {
    id: '69e1212745fcceb0f02f49f3',
    paragraph: `Doing necessary tasks and ① forming new habits are two things people constantly put off. However, neither one is difficult or time-consuming — people just ② avoid doing them. The two-minute rule solves this problem by ③ made it easier to get started. When you have a task ④ to complete, imagine how long it will take. If you think it will take less than two minutes, then do it right away. And when you're having trouble starting a new habit, focus on an activity that takes less than two minutes. Soon you will get in the habit of ⑤ writing for an hour at a time.`,
    question: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
    explanation:
      '③이 정답. "The two-minute rule solves this problem by ③ made it easier to get started"에서 전치사 by 뒤에는 동명사(V-ing)가 와야 하는데, ③ made는 과거동사이므로 어법상 틀렸습니다. making으로 고쳐야 합니다. ①forming(Doing과 and로 연결된 동명사), ②avoid doing(avoid + V-ing), ④to complete(task를 수식하는 형용사적 부정사), ⑤writing(get in the habit of + V-ing)은 모두 어법에 맞습니다.',
  },

  // ── 어법 (Lionfish) ────────────────────────────────────────────────
  {
    id: '69e1214c45fcceb0f02f49fa',
    paragraph: `Lionfish are common in aquariums because of their interesting ① color patterns and their large, wavy fins. While young lionfish are about two centimeters long, adults ② grow to 15 times this length. The habitat of lionfish is spreading, but their original home was a stretch of ocean ③ between Australia and South Korea. They feed on shrimp and smaller fish, and are known for their big appetites. In fact, lionfish have stomachs ④ that can increase in size by as much as 30 times when full. They also breed rapidly, with female lionfish ⑤ release about 2 million eggs throughout the year.`,
    question: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
    explanation:
      '⑤가 정답. "with female lionfish ⑤ release about 2 million eggs throughout the year"에서 \'with + 목적어 + 분사\' 부대상황 구문이어야 하므로, ⑤ release(동사 원형)를 현재분사 releasing으로 고쳐야 합니다. ①color(명사 수식어), ②grow(현재 사실을 나타내는 현재동사), ③between(Australia와 South Korea를 잇는 전치사), ④that can increase(stomachs를 수식하는 목적격 관계대명사절)는 모두 어법에 맞습니다.',
  },

  // ── 주제 (Lionfish) ────────────────────────────────────────────────
  {
    id: '69e1213445fcceb0f02f49f5',
    paragraph: LIONFISH_BASE,
    question: '다음 글의 주제로 가장 적절한 것은?',
    explanation:
      '①이 정답입니다. 글은 사자물고기의 화려한 외모(색채·지느러미), 크기 성장, 서식지, 식성과 큰 식욕, 빠른 번식력, 그리고 독침으로 인한 인간에 대한 위험까지 다양한 신체적 특징과 위험한 속성을 설명합니다. ②는 수족관 보관의 중요성에 국한, ③는 인간 보호 방법에 국한, ④는 식성에만 치중, ⑤는 서식지 확대에만 치중합니다.',
  },

  // ── 제목 (Lionfish) ────────────────────────────────────────────────
  {
    id: '69e1213845fcceb0f02f49f6',
    paragraph: LIONFISH_BASE,
    question: '다음 글의 제목으로 가장 적절한 것은?',
    explanation:
      '①이 정답입니다. 글은 사자물고기의 눈에 띄는 외모(색채·지느러미)와 독침·번식력 등 위험한 특성을 균형 있게 소개합니다. \'Lionfish: Striking in Looks, Deadly in Nature\'가 이 두 측면을 간결하게 함축합니다. ②는 수족관에서의 인기에만 집중, ③는 식성 중심, ④는 지문이 언급하지 않는 멸종 위기종 주제, ⑤는 지문에 없는 산호초 오염 내용입니다.',
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let updated = 0;
  for (const p of PATCHES) {
    const filter = { _id: new ObjectId(p.id) };
    const doc = await col.findOne(filter, { projection: { 'question_data.Paragraph': 1 } });
    if (!doc) { console.warn(`⚠ 문서 없음: ${p.id}`); continue; }

    if (DRY_RUN) {
      console.log(`[dry] ${p.id}`);
      console.log(`  paragraph: ${p.paragraph.slice(0, 60)}...`);
      console.log(`  question:  ${p.question.slice(0, 60)}...`);
    } else {
      await col.updateOne(filter, {
        $set: {
          'question_data.Paragraph': p.paragraph,
          'question_data.Question': p.question,
          'question_data.Explanation': p.explanation,
          updated_at: new Date(),
        },
      });
      console.log(`✔ ${p.id}`);
      updated++;
    }
  }
  console.log(DRY_RUN ? `[dry-run] ${PATCHES.length}건 완료` : `완료: ${updated}건 업데이트`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
