import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const GUMDROP = `A British company has created a new product called a Gumdrop, which is a bin. Not only do these bins hold old chewing gum, but they are also made from it. They were designed as a solution to chewing gum waste. Instead of ending up buried in the ground, the gum in Gumdrops is recycled. After it is recycled, the gum can be used to create a plastic-like material called Gum-tec. Besides new Gumdrops, this compound can be used to make a variety of products, including rainboots, phone cases, and cups. Gumdrops also help reduce gum stains, making public places a bit cleaner.`;

const SAYING_NO = `How often have you agreed to do something that you didn't really want to do? Maybe you went to a concert of your friend's favorite band or you helped your cousin study for a test when you would rather have just relaxed at home. Most of us enjoy being with our friends, and we like to help the people that we care about. So it is often hard for us to say no. However, trying to do so many good things can turn these usually enjoyable activities into burdens. Therefore, you must practice saying no sometimes, and you don't always need to give an excuse. Saying no to activities that you don't want to do will allow you to fully enjoy the activities that you choose to do.`;

const VOCABULARY = `Children learn much of their vocabulary through daily conversation. But these conversations are not enough. Children who don't spend time reading with adults are at a disadvantage. Parents can improve their children's vocabulary by reading aloud to them. Parents can explain new vocabulary by asking their children questions and giving definitions. For example, when children find an unfamiliar word, parents can take a moment to ask them what they think it means. If the children are unsure, the parents can read the word in context and give the children clues about the word's meaning. If the meaning is still unclear, parents can provide a definition, adding the new word to their children's vocabulary.`;

const SELF_ORDER = `For businesses that need good customer service, the preferences of customers are extremely important. People today increasingly prefer to be left alone by salespeople and other staff members. Because of this, many large companies have started using a strategy that reduces personal interaction between customers and employees. You may have seen this at fast-food restaurants. In some of these places, customers can enter their own orders on screens. With a few taps, they can select their items and pay. Even new customers can quickly become comfortable with using these screens. Moreover, the screens lead to fewer employee mistakes and increase the speed of each purchase.`;

const MARY_ANNING = `Mary Anning was born in England in 1799. When she was a child, she didn't have much schooling. But her father taught her how to find fossils on the beach. After he died, she began selling fossils to earn money. She soon became skilled at finding important dinosaur fossils. In 1823, she found the first complete skeleton of Plesiosaurus, a type of dinosaur. Five years later, she found the first pterosaur fossil outside of Germany. Over the years, Anning continued to find valuable fossils. In 1838, the Geological Society began to pay her an annual salary. Because she was a woman, however, she was not allowed to become a member. Today she is remembered for her valuable contributions to science.`;

const FRENCH_FRIES = `French fries are popular around the world. They are a simple dish, so they should be easy to make at home. You just have to slice up some potatoes and fry them in oil. However, making delicious French fries is not as easy as it seems. In fact, most people agree that fast-food French fries taste better than homemade ones. This is because most fast-food restaurants double cook their French fries. They purchase their French fries frozen, which means they have already been fried once. Frying them again releases much of the moisture inside the French fries. As a result, they are crispy and delicious. So, if you want to enjoy the taste of fast-food French fries at home, don't buy potatoes. Instead, buy a bag of frozen French fries and fry them again.`;

const EMPLOYEE = `Many managers believe that all employees should be treated the same way. While this may seem fair, every worker is different. Their personalities can range from shy to outgoing. Some might be self-motivated and independent. Others may need a lot of guidance or encouragement. This is why you must learn what motivates your employees. Ask them what their goals are and find out how they prefer to receive praise. A shy engineer would not want to be given an award in front of the whole company. On the other hand, an energetic salesperson could see it as an honor and a reward. Each person is unique, and treatment of employees should reflect that. Otherwise, a company's attempts to be fair could lead to unhappiness in its employees.`;

const ARTS_SCIENCE = `Students often forget much of what they learn in science classes. To help prevent this, a group of researchers is suggesting that teachers add artistic activities to science lessons. The researchers studied 350 students from 16 separate classrooms in Baltimore, Maryland. The students took part in either arts-integrated science classes or conventional science classes for three to four weeks. In the arts-integrated classes, students drew plant cells to help them understand the structures of these cells. They also memorized and sang songs with lyrics containing information from their textbooks. These students remembered the information longer and in more detail than students who tried to learn the same information using only traditional classroom activities.`;

const SCREEN_TIME = `Do you carry your phone everywhere, as if it were attached to you? Like many people, you might be unable to imagine a life without your smartphone. You might worry about the deprivation and boredom that you would experience if you reduced your phone time. However, less screen time would actually be a chance for you to be less stressed, more creative, more thoughtful, and more in touch with yourself. What did you enjoy before smartphones? What joys in life are passing by as you stare at your screen? Consider spending more time away from your phone to answer these questions. You'll find that you have more freedom, more time, and more ways to be true to yourself.`;

const TWO_MINUTE = `Doing necessary tasks and forming new habits are two things people constantly put off. However, neither one is difficult or time-consuming — people just avoid doing them. The two-minute rule solves this problem by making it easier to get started. When you have a task to complete, imagine how long it will take. If you think it will take less than two minutes, then do it right away. And when you're having trouble starting a new habit, focus on an activity that takes less than two minutes. For example, most good writers have a habit of writing for at least an hour each day. To start this kind of habit, however, you just need to take a minute or two each day to write a sentence. Soon you will get in the habit of writing for an hour at a time.`;

const LIONFISH = `Lionfish are common in aquariums because of their interesting color patterns and their large, wavy fins. While young lionfish are about two centimeters long, adults grow to 15 times this length. The habitat of lionfish is spreading, but their original home was a stretch of ocean between Australia and South Korea. They feed on shrimp and smaller fish, and are known for their big appetites. In fact, lionfish have stomachs that can increase in size by as much as 30 times when full. They also breed rapidly, with female lionfish releasing about 2 million eggs throughout the year. Lionfish defend themselves with venomous spines. If a lionfish stings a human, the person experiences sweating, pain, and sometimes even difficulty breathing and paralysis.`;

const Q_INSTR = '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?';

const PATCHES: { id: string; paragraph: string; question: string; explanation: string }[] = [
  // ── Gumdrop ──────────────────────────────────────────────────────
  {
    id: '69e0aee345fcceb0f02f4892',
    paragraph: GUMDROP,
    question: `${Q_INSTR}\n\nGumdrop bins, made from (A)__________ chewing gum, recycle it into Gum-tec to create (B)__________ products.`,
    explanation:
      '①이 정답입니다. (A) old: 지문에서 "these bins hold old chewing gum"이라고 직접 명시했으므로 \'오래된(old)\' 껌이 맞습니다. (B) various: 지문에서 "this compound can be used to make a variety of products, including rainboots, phone cases, and cups"라고 했으므로 \'다양한(various)\' 제품이 맞습니다. ②fresh·limited, ③recycled·expensive, ④melted·traditional, ⑤unused·specific는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0aee645fcceb0f02f4893',
    paragraph: GUMDROP,
    question: `${Q_INSTR}\n\nDesigned as a (A)__________ to gum waste, Gumdrops recycle old chewing gum into Gum-tec, a material used to make (B)__________ items.`,
    explanation:
      '①이 정답입니다. (A) solution: 지문에서 "They were designed as a solution to chewing gum waste"라고 직접 명시했으므로 \'해결책(solution)\'이 맞습니다. (B) various: 지문에서 "a variety of products, including rainboots, phone cases, and cups"라고 했으므로 \'다양한(various)\' 아이템이 맞습니다. ②response·similar, ③challenge·expensive, ④contribution·limited, ⑤alternative·old는 지문 내용과 맞지 않습니다.',
  },

  // ── Saying No ────────────────────────────────────────────────────
  {
    id: '69e0af3045fcceb0f02f48a0',
    paragraph: SAYING_NO,
    question: `${Q_INSTR}\n\nAlthough it is (A)__________ to say no because we enjoy helping others, refusing activities we (B)__________ to do allows us to better enjoy our chosen ones.`,
    explanation:
      '①이 정답입니다. (A) hard: 지문에서 "it is often hard for us to say no"라고 직접 명시했으므로 \'어려운(hard)\'이 맞습니다. (B) don\'t want: 지문에서 "Saying no to activities that you don\'t want to do"라고 했으므로 \'하고 싶지 않은(don\'t want)\'이 맞습니다. ②easy·prefer(방향 반대), ③important·need, ④natural·have, ⑤common·refuse는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0af3345fcceb0f02f48a1',
    paragraph: SAYING_NO,
    question: `${Q_INSTR}\n\nSaying no to (A)__________ activities can prevent them from becoming (B)__________, letting you fully enjoy what you truly choose.`,
    explanation:
      '①이 정답입니다. (A) unwanted: 지문에서 "activities that you don\'t want to do"를 가리키므로 \'원하지 않는(unwanted)\'이 적절합니다. (B) burdens: 지문에서 "trying to do so many good things can turn these usually enjoyable activities into burdens"라고 직접 명시했으므로 \'부담(burdens)\'이 맞습니다. ②favorite·hobbies, ③difficult·rewards, ④social·habits, ⑤exciting·obligations는 지문 내용과 맞지 않습니다.',
  },

  // ── Vocabulary ───────────────────────────────────────────────────
  {
    id: '69e0af8045fcceb0f02f48ae',
    paragraph: VOCABULARY,
    question: `${Q_INSTR}\n\nWhile daily conversation helps, parents who read aloud to their children can (A)__________ their vocabulary by providing questions, clues, and (B)__________ for unfamiliar words.`,
    explanation:
      '①이 정답입니다. (A) improve: 지문에서 "Parents can improve their children\'s vocabulary by reading aloud to them"이라고 직접 명시했으므로 \'향상시킨다(improve)\'가 맞습니다. (B) definitions: 지문에서 "asking their children questions and giving definitions"라고 명시했으므로 \'정의(definitions)\'가 맞습니다. ②limit·questions, ③test·stories, ④reduce·examples, ⑤develop·sentences는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0af8345fcceb0f02f48af',
    paragraph: VOCABULARY,
    question: `${Q_INSTR}\n\nChildren gain more vocabulary when parents (A)__________ aloud to them and explain (B)__________ words by offering context clues and definitions.`,
    explanation:
      '①이 정답입니다. (A) read: 지문에서 "reading aloud to them"이라고 직접 명시했으므로 \'소리 내어 읽어준다(read)\'가 맞습니다. (B) unfamiliar: 지문에서 "when children find an unfamiliar word"와 맥락 단서·정의 설명 대상이 \'낯선 단어(unfamiliar words)\'입니다. ②talk·simple, ③listen·common, ④write·new, ⑤learn·difficult는 지문 내용과 맞지 않습니다.',
  },

  // ── Self-ordering screens ─────────────────────────────────────────
  {
    id: '69e0afe645fcceb0f02f48bc',
    paragraph: SELF_ORDER,
    question: `${Q_INSTR}\n\nAs customers increasingly prefer (A)__________ interaction with staff, companies use self-ordering screens, which reduce employee mistakes and (B)__________ purchase speed.`,
    explanation:
      '①이 정답입니다. (A) less: 지문에서 "People today increasingly prefer to be left alone by salespeople and other staff members"이라고 했으므로 직원과의 상호작용을 \'더 적게(less)\' 원한다는 것이 맞습니다. (B) increase: 지문에서 "the screens lead to fewer employee mistakes and increase the speed of each purchase"라고 직접 명시했으므로 \'증가시킨다(increase)\'가 맞습니다. ②more·decrease, ③personal·reduce, ④direct·limit, ⑤frequent·maintain은 지문 내용과 맞지 않습니다.',
  },

  // ── Mary Anning ───────────────────────────────────────────────────
  {
    id: '69e0afe945fcceb0f02f48bd',
    paragraph: MARY_ANNING,
    question: `${Q_INSTR}\n\nMary Anning, who learned fossil hunting from her (A)__________, made key dinosaur discoveries but was denied (B)__________ in the Geological Society due to her gender.`,
    explanation:
      '①이 정답입니다. (A) father: 지문에서 "her father taught her how to find fossils on the beach"라고 직접 명시했으므로 \'아버지(father)\'가 맞습니다. (B) membership: 지문에서 "she was not allowed to become a member"라고 했으므로 \'회원 자격(membership)\'이 맞습니다. ②teacher·payment, ③mother·recognition, ④mentor·funding, ⑤neighbor·support는 지문 내용과 맞지 않습니다.',
  },

  // ── French Fries ─────────────────────────────────────────────────
  {
    id: '69e0b04045fcceb0f02f48ca',
    paragraph: FRENCH_FRIES,
    question: `${Q_INSTR}\n\nFast-food French fries taste better because they are (A)__________ twice, which releases moisture and makes them (B)__________.`,
    explanation:
      '①이 정답입니다. (A) fried: 지문에서 "double cook their French fries"와 "already been fried once"에서 두 번 \'튀겨진다(fried)\'가 핵심입니다. (B) crispy: 지문에서 "Frying them again releases much of the moisture inside the French fries. As a result, they are crispy and delicious."라고 직접 명시했으므로 \'바삭한(crispy)\'이 맞습니다. ②frozen·tastier, ③sliced·softer, ④seasoned·fresher, ⑤cooked·larger는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0b04145fcceb0f02f48cb',
    paragraph: FRENCH_FRIES,
    question: `${Q_INSTR}\n\nTo make (A)__________ French fries at home, buy (B)__________ ones and fry them again rather than starting with raw potatoes.`,
    explanation:
      '①이 정답입니다. (A) crispy: 지문에서 두 번 튀기면 "crispy and delicious"해진다고 했으므로 \'바삭한(crispy)\' 감자튀김을 목표로 한다는 것이 맞습니다. (B) frozen: 지문에서 "don\'t buy potatoes. Instead, buy a bag of frozen French fries and fry them again"이라고 직접 제안했으므로 \'냉동(frozen)\' 감자튀김이 맞습니다. ②soft·fresh, ③healthy·organic, ④large·thick, ⑤cheap·dried는 지문 내용과 맞지 않습니다.',
  },

  // ── Employee Management ───────────────────────────────────────────
  {
    id: '69e0b09645fcceb0f02f48d8',
    paragraph: EMPLOYEE,
    question: `${Q_INSTR}\n\nSince employees have (A)__________ personalities and needs, managers should understand what (B)__________ each individual rather than treating everyone the same.`,
    explanation:
      '①이 정답입니다. (A) different: 지문에서 "every worker is different"이라고 직접 명시했으므로 \'서로 다른(different)\' 개성과 필요가 맞습니다. (B) motivates: 지문에서 "you must learn what motivates your employees"라고 직접 명시했으므로 \'동기를 부여하는 것(motivates)\'이 맞습니다. ②similar·rewards, ③positive·impresses, ④strong·challenges, ⑤weak·supports는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0b09945fcceb0f02f48d9',
    paragraph: EMPLOYEE,
    question: `${Q_INSTR}\n\nRather than applying (A)__________ treatment to all employees, managers should recognize each worker's unique preferences to avoid (B)__________ in the workplace.`,
    explanation:
      '①이 정답입니다. (A) uniform: 지문에서 "all employees should be treated the same way"가 획일적 대우를 가리키므로 \'획일적인(uniform)\' 대우가 맞습니다. (B) unhappiness: 지문에서 "a company\'s attempts to be fair could lead to unhappiness in its employees"라고 직접 명시했으므로 \'불만족(unhappiness)\'이 맞습니다. ②fair·conflict, ③strict·mistakes, ④flexible·stress, ⑤simple·confusion은 지문 내용과 맞지 않습니다.',
  },

  // ── Arts-integrated Science ───────────────────────────────────────
  {
    id: '69e0b10545fcceb0f02f48e6',
    paragraph: ARTS_SCIENCE,
    question: `${Q_INSTR}\n\nA study found that students in (A)__________ science classes, who drew cells and sang songs, (B)__________ science information better than those in traditional classes.`,
    explanation:
      '①이 정답입니다. (A) arts-integrated: 지문에서 "arts-integrated science classes"라고 직접 명시했으므로 \'예술 통합(arts-integrated)\' 수업이 맞습니다. (B) remembered: 지문에서 "These students remembered the information longer and in more detail"이라고 직접 명시했으므로 \'기억했다(remembered)\'가 맞습니다. ②traditional·learned, ③advanced·understood, ④online·accessed, ⑤special·tested는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0b10945fcceb0f02f48e7',
    paragraph: ARTS_SCIENCE,
    question: `${Q_INSTR}\n\nResearchers suggest adding (A)__________ to science lessons because it helps students (B)__________ information longer and in more detail.`,
    explanation:
      '①이 정답입니다. (A) artistic activities: 지문에서 "researchers is suggesting that teachers add artistic activities to science lessons"라고 직접 명시했으므로 \'예술적 활동(artistic activities)\'이 맞습니다. (B) remember: 지문에서 "These students remembered the information longer and in more detail"이라고 했으므로 \'기억하다(remember)\'가 맞습니다. ②extra practice·review, ③group discussions·share, ④technology tools·access, ⑤written tests·recall은 지문 내용과 맞지 않습니다.',
  },

  // ── Screen Time ───────────────────────────────────────────────────
  {
    id: '69e0b13c45fcceb0f02f48f4',
    paragraph: SCREEN_TIME,
    question: `${Q_INSTR}\n\nAlthough people worry about (A)__________ and boredom from using phones less, reducing screen time actually offers more (B)__________ and opportunities to be true to oneself.`,
    explanation:
      '①이 정답입니다. (A) deprivation: 지문에서 "You might worry about the deprivation and boredom that you would experience if you reduced your phone time"이라고 직접 명시했으므로 \'박탈감(deprivation)\'이 맞습니다. (B) freedom: 지문에서 "You\'ll find that you have more freedom, more time, and more ways to be true to yourself"라고 했으므로 \'자유(freedom)\'가 맞습니다. ②stress·connection, ③loneliness·relaxation, ④distraction·productivity, ⑤addiction·happiness는 지문 내용과 맞지 않습니다.',
  },
  {
    id: '69e0b14045fcceb0f02f48f5',
    paragraph: SCREEN_TIME,
    question: `${Q_INSTR}\n\nPeople who (A)__________ from their smartphones can become less stressed and more creative, gaining the chance to reconnect with (B)__________ and the joys of life.`,
    explanation:
      '①이 정답입니다. (A) take time away: 지문에서 "Consider spending more time away from your phone"이라고 했으므로 스마트폰에서 \'시간을 떼어놓는(take time away)\'이 맞습니다. (B) themselves: 지문에서 "more ways to be true to yourself"와 "more in touch with yourself"에서 자기 자신과 다시 연결되는 것이므로 \'자기 자신(themselves)\'이 맞습니다. ②hide·friends, ③escape·nature, ④disconnect·technology, ⑤learn·others는 지문 내용과 맞지 않습니다.',
  },

  // ── Two-Minute Rule ───────────────────────────────────────────────
  {
    id: '69e1211f45fcceb0f02f49f1',
    paragraph: TWO_MINUTE,
    question: `${Q_INSTR}\n\n→ The two-minute rule encourages people to tackle tasks immediately if they take fewer than (A)___ minutes and to build new habits by starting with (B)___ activities.`,
    explanation:
      '①이 정답입니다. (A) two: 지문에서 "If you think it will take less than two minutes, then do it right away"라고 직접 명시했으므로 \'2분(two)\'이 맞습니다. (B) brief: 지문에서 "focus on an activity that takes less than two minutes"라고 했으므로 \'짧은(brief)\' 활동으로 시작하는 것이 맞습니다. ②three·complex, ③five·boring, ④two·lengthy(B가 반대 의미), ⑤ten·useful는 지문 내용과 맞지 않습니다.',
  },

  // ── Lionfish ──────────────────────────────────────────────────────
  {
    id: '69e1214245fcceb0f02f49f8',
    paragraph: LIONFISH,
    question: `${Q_INSTR}\n\n→ Lionfish are well known for their (A)___ appearance and pose a real danger to humans because of their (B)___ spines.`,
    explanation:
      '①이 정답입니다. (A) striking: 지문에서 "interesting color patterns and their large, wavy fins" 때문에 수족관에서 흔히 볼 수 있다고 했으므로 \'눈에 띄는(striking)\' 외모가 맞습니다. (B) venomous: 지문에서 "Lionfish defend themselves with venomous spines"라고 직접 명시했으므로 \'독이 있는(venomous)\'이 맞습니다. ②dull·sharp, ③dark·long, ④striking·harmless(B가 반대), ⑤tiny·colorful는 지문 내용과 맞지 않습니다.',
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let updated = 0;
  for (const p of PATCHES) {
    const filter = { _id: new ObjectId(p.id) };
    const doc = await col.findOne(filter, { projection: { 'question_data.Paragraph': 1, 'question_data.Question': 1 } });
    if (!doc) { console.warn(`⚠ 문서 없음: ${p.id}`); continue; }

    if (DRY_RUN) {
      console.log(`[dry] ${p.id}`);
      console.log(`  paragraph: ${p.paragraph.slice(0, 60)}...`);
      console.log(`  question:  ${p.question.slice(0, 80)}...`);
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
