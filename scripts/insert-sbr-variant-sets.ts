/**
 * 성보람(VIP) '내 문제'에 두 지문(재활용·업사이클링 / SNS)을 문맥 분할해
 * 객관식 변형문제 2세트씩 생성·저장하고 폴더로 담는다. (Pro 전용 — 손으로 작성한 question_data 저장만)
 *
 *   npx tsx scripts/insert-sbr-variant-sets.ts            # dry-run (검증·계획만)
 *   npx tsx scripts/insert-sbr-variant-sets.ts --apply    # passages+generated_questions+vip_saved_questions 저장
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';
import { QUESTION_BANK_COLLECTION, ensureQuestionBankIndexes, previewText } from '@/lib/vip-question-bank-store';

loadCliEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const APPLY = process.argv.includes('--apply');
const OWNER_LOGIN = '01091360422'; // 성보람

// ───────────────────────── 지문(문맥 분할) ─────────────────────────
const TB_A = 'Recycling and Upcycling';
const TB_B = 'The World of SNS';

const A1 = `Many people want to protect the environment today. "Upcycling" and "recycling" are becoming popular words. Both aim to reduce waste. But they are not the same. Learning the differences is useful for people and businesses. It helps to make better choices for the environment. Recycling means breaking down waste materials. We use them to create new products. This helps to reduce the use of new resources and it also keeps waste away from landfills. For example, people enjoy putting plastic bottles into recycling bins. Some people like collecting old newspapers for recycling. Others try returning aluminum cans to recycling centers.`;
const A2 = `The recycling process has four steps. First, people collect materials from homes, businesses, or drop-off points. Next, workers sort items by type, such as plastic, paper, or metal. After they sort the items, they clean, shred, or melt the materials into raw materials. Finally, manufacturers use these raw materials to produce new products. Thanks to this process, recycling helps to conserve natural resources like timber, water, and minerals. It also helps to reduce energy consumption in manufacturing. In addition, recycling helps to decrease greenhouse gas emissions.`;
const A3 = `Upcycling means repurposing waste materials or unwanted items. We use them to create new products with higher value. Unlike recycling, upcycling keeps the original structure of materials. So upcycling does not need much processing. For example, people enjoy turning old wooden pallets into furniture. Some people like repurposing glass jars as storage containers or planters. Others try transforming outdated clothing into new fashion pieces or accessories. As a result, upcycling requires less energy than recycling because materials do not need breaking down. It also gives materials a new purpose and extends their life. Both recycling and upcycling help to create a healthier planet for future generations.`;

const B1 = `Today, many teenagers use social media (SNS) every day. It is very exciting, but we need to know the trends and the rules of social media. Teenagers love YouTube Shorts, Instagram Reels, and TikTok. They make 15-second videos. They dance, sing, or do fun missions to popular music with their friends. Students often go to photo booths to take pictures. They edit these photos with cool music or stickers. Then, they put them on their SNS stories.`;
const B2 = `Many students have a main account and a private account. On the private account, they only accept their close friends. They show their best friends their real everyday lives and honest feelings. Internet memes are also very popular. Students copy funny videos or famous phrases. They also use special AI filters. These filters change their faces into cartoon characters or funny styles. Then they share these photos with others.`;
const B3 = `SNS is a lot of fun, but it can cause problems, so we must remember some important rules. First, always ask for permission. When you upload a picture of your friend, you must ask, "Can I post this?" Second, never write bad things about a friend without a name, because everyone can still guess the friend. This is called "targeting," and it is a type of school violence. Third, remember digital footprints. Even on private accounts, someone can take a screenshot to spread your words forever. Finally, hide your personal information and do not use real-time location tags to stay safe.`;

const PASSAGES = [
  { key: 'A1', textbook: TB_A, source: 'Recycling and Upcycling ①', original: A1 },
  { key: 'A2', textbook: TB_A, source: 'Recycling and Upcycling ②', original: A2 },
  { key: 'A3', textbook: TB_A, source: 'Recycling and Upcycling ③', original: A3 },
  { key: 'B1', textbook: TB_B, source: 'The World of SNS ①', original: B1 },
  { key: 'B2', textbook: TB_B, source: 'The World of SNS ②', original: B2 },
  { key: 'B3', textbook: TB_B, source: 'The World of SNS ③', original: B3 },
];

// 빈칸/어휘용 파생 지문
const A2_BLANK = A2.replace('conserve natural resources like timber, water, and minerals', '<u>________________________________</u>');
const A3_VOCAB = `Upcycling means ①repurposing waste materials or unwanted items. We use them to create new products with ②higher value. Unlike recycling, upcycling keeps the ③original structure of materials. So upcycling does not need much processing. For example, people enjoy turning old wooden pallets into furniture. Some people like repurposing glass jars as storage containers or planters. Others try transforming outdated clothing into new fashion pieces or accessories. As a result, upcycling requires ④more energy than recycling because materials do not need breaking down. It also ⑤extends their life. Both recycling and upcycling help to create a healthier planet for future generations.`;
const B2_BLANK = B2.replace('cartoon characters or funny styles', '<u>________________________</u>');
const B2_VOCAB = `Many students have a main account and a ①private account. On the private account, they only ②reject their close friends. They show their best friends their real everyday lives and ③honest feelings. Internet memes are also very ④popular. Students copy funny videos or famous phrases. They also use special AI filters. These filters change their faces into cartoon characters or funny styles. Then they ⑤share these photos with others.`;

const nl = (opts: string[]) => opts.join('\n');
const hs = (opts: string[]) => opts.join(' ### ');

type Q = { passageKey: string; type: string; question_data: Record<string, unknown> };
type VSet = { folder: string; textbook: string; source: string; items: Q[] };

const SETS: VSet[] = [
  {
    folder: '재활용·업사이클링 세트1', textbook: TB_A, source: 'Recycling and Upcycling',
    items: [
      { passageKey: 'A1', type: '주제', question_data: {
        Question: '다음 글의 주제로 가장 적절한 것은?', Paragraph: A1,
        Options: nl([
          '① the meaning of recycling and familiar ways people practice it',
          '② the difficulty of separating plastic, paper, and metal waste',
          '③ economic benefits businesses gain from selling old newspapers',
          '④ the negative effects of using too many aluminum cans',
          '⑤ reasons why landfills keep increasing around the world',
        ]), CorrectAnswer: '①',
        Explanation: '① the meaning of recycling and familiar ways people practice it\n*해설: 글은 재활용이 폐기물을 분해해 새 제품을 만드는 것이라는 정의와, 페트병·신문·캔을 모으는 일상적 실천 예시를 소개하고 있다.' } },
      { passageKey: 'A2', type: '빈칸', question_data: {
        Question: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?', Paragraph: A2_BLANK,
        Options: nl([
          '① conserve natural resources like timber, water, and minerals',
          '② increase the demand for brand-new raw materials',
          '③ speed up the growth of landfills in big cities',
          '④ replace the need for factories and manufacturers',
          '⑤ make sorting waste by type completely unnecessary',
        ]), CorrectAnswer: '①',
        Explanation: '① conserve natural resources like timber, water, and minerals\n*해설: 빈칸 뒤에서 제조 에너지 절감·온실가스 감소를 나열하므로, 빈칸에도 재활용의 긍정적 효과인 천연자원 보존이 들어가야 한다.' } },
      { passageKey: 'A3', type: '어휘', question_data: {
        Question: '다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?', Paragraph: A3_VOCAB,
        Options: hs(['① repurposing', '② higher', '③ original', '④ more', '⑤ extends']), CorrectAnswer: '④',
        Explanation: '정답 ④. 바로 뒤에서 "재료를 분해할 필요가 없다(materials do not need breaking down)"고 했으므로 업사이클링은 재활용보다 에너지가 "더 적게(less)" 든다. 따라서 ④ more는 문맥상 부적절하며 less가 적절하다.' } },
    ],
  },
  {
    folder: '재활용·업사이클링 세트2', textbook: TB_A, source: 'Recycling and Upcycling',
    items: [
      { passageKey: 'A1', type: '제목', question_data: {
        Question: '다음 글의 제목으로 가장 적절한 것은?', Paragraph: A1,
        Options: nl([
          '① Recycling: Turning Everyday Waste into New Products',
          '② The Hidden Dangers of Plastic Bottles and Cans',
          '③ How Businesses Profit from Collecting Old Newspapers',
          '④ Why Landfills Are the Best Solution for Our Waste',
          '⑤ Upcycling Has Completely Replaced Recycling at Home',
        ]), CorrectAnswer: '①',
        Explanation: '① Recycling: Turning Everyday Waste into New Products\n*해설: 글은 재활용의 정의와 페트병·신문·캔을 모아 새 제품을 만드는 과정을 설명하므로, 일상의 폐기물을 새 제품으로 바꾸는 재활용이 제목으로 적절하다.' } },
      { passageKey: 'A2', type: '일치', question_data: {
        Question: '다음 글의 내용과 일치하는 것은?', Paragraph: A2,
        Options: nl([
          '① The recycling process is completed in only two main steps.',
          '② Workers sort materials by type before cleaning or melting them.',
          '③ Manufacturers gather waste directly from homes by themselves.',
          '④ Recycling increases the energy used in manufacturing.',
          '⑤ Recycling has no effect on greenhouse gas emissions.',
        ]), CorrectAnswer: '②',
        Explanation: '② Workers sort materials by type before cleaning or melting them.\n*해설: 본문에서 수거 → 유형별 분류 → 세척·분쇄·용해 → 새 제품 생산의 4단계를 거친다고 했으므로, 분류가 세척·용해보다 앞선다는 ②가 일치한다.' } },
      { passageKey: 'A3', type: '불일치', question_data: {
        Question: '다음 글의 내용과 일치하지 않는 것은?', Paragraph: A3,
        Options: nl([
          '① Upcycling keeps the original structure of the materials it uses.',
          '② Old wooden pallets can be turned into furniture through upcycling.',
          '③ Upcycling requires more processing and energy than recycling.',
          '④ Glass jars can be repurposed as storage containers or planters.',
          '⑤ Upcycling gives materials a new purpose and extends their life.',
        ]), CorrectAnswer: '③',
        Explanation: '③ Upcycling requires more processing and energy than recycling.\n*해설: 본문은 업사이클링이 재료의 원래 구조를 유지해 많은 가공이 필요 없고 재활용보다 에너지가 적게 든다고 했으므로, "더 많은 가공·에너지"라는 ③은 일치하지 않는다.' } },
    ],
  },
  {
    folder: 'SNS 트렌드·규칙 세트1', textbook: TB_B, source: 'The World of SNS',
    items: [
      { passageKey: 'B1', type: '주제', question_data: {
        Question: '다음 글의 주제로 가장 적절한 것은?', Paragraph: B1,
        Options: nl([
          '① popular social media trends that teenagers enjoy today',
          '② the best way to become famous on YouTube Shorts',
          '③ reasons teenagers should stop using photo booths',
          '④ how to make professional 15-second music videos',
          '⑤ the technical process of editing photos with stickers',
        ]), CorrectAnswer: '①',
        Explanation: '① popular social media trends that teenagers enjoy today\n*해설: 글은 숏폼 영상, 포토부스 사진 편집 등 십 대가 즐기는 SNS 유행을 소개하고 있다.' } },
      { passageKey: 'B2', type: '빈칸', question_data: {
        Question: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?', Paragraph: B2_BLANK,
        Options: nl([
          '① cartoon characters or funny styles',
          '② their real school uniforms',
          '③ boring black-and-white photos',
          '④ their parents’ old pictures',
          '⑤ plain white backgrounds',
        ]), CorrectAnswer: '①',
        Explanation: '① cartoon characters or funny styles\n*해설: AI 필터가 얼굴을 바꾼다고 했고 이어서 재미있는 사진을 공유한다고 했으므로, 빈칸에는 얼굴을 만화 캐릭터나 재미있는 스타일로 바꾼다는 내용이 적절하다.' } },
      { passageKey: 'B3', type: '일치', question_data: {
        Question: '다음 글의 내용과 일치하는 것은?', Paragraph: B3,
        Options: nl([
          '① Writing bad things about a friend is safe if you hide the name.',
          '② Screenshots on private accounts always disappear after a day.',
          '③ Sharing your real-time location helps keep you safe online.',
          '④ Targeting classmates online is treated as harmless fun.',
          '⑤ You should ask a friend before posting a picture of them.',
        ]), CorrectAnswer: '⑤',
        Explanation: '⑤ You should ask a friend before posting a picture of them.\n*해설: 본문은 친구 사진을 올릴 때 반드시 허락을 구하라("Can I post this?")고 했으므로 ⑤가 일치한다.' } },
    ],
  },
  {
    folder: 'SNS 트렌드·규칙 세트2', textbook: TB_B, source: 'The World of SNS',
    items: [
      { passageKey: 'B1', type: '제목', question_data: {
        Question: '다음 글의 제목으로 가장 적절한 것은?', Paragraph: B1,
        Options: nl([
          '① Fun Social Media Trends Among Today’s Teenagers',
          '② The Dangers of Spending Money in Photo Booths',
          '③ How to Win a Dance Contest on TikTok',
          '④ Why Teenagers Should Delete Their SNS Accounts',
          '⑤ A Complete Guide to Editing Music Videos',
        ]), CorrectAnswer: '①',
        Explanation: '① Fun Social Media Trends Among Today’s Teenagers\n*해설: 글은 숏폼, 포토부스 편집 등 십 대가 즐기는 SNS 유행을 다루므로 제목으로 적절하다.' } },
      { passageKey: 'B2', type: '어휘', question_data: {
        Question: '다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?', Paragraph: B2_VOCAB,
        Options: hs(['① private', '② reject', '③ honest', '④ popular', '⑤ share']), CorrectAnswer: '②',
        Explanation: '정답 ②. 비공개 계정에는 친한 친구만 "받아들인다(accept)"가 되어야 문맥에 맞다. 따라서 ② reject(거절하다)는 부적절하며 accept가 적절하다.' } },
      { passageKey: 'B3', type: '불일치', question_data: {
        Question: '다음 글의 내용과 일치하지 않는 것은?', Paragraph: B3,
        Options: nl([
          '① You must ask permission before posting a friend’s picture.',
          '② Targeting is considered a type of school violence.',
          '③ Even on private accounts, your words can be screenshotted and spread.',
          '④ Using real-time location tags is recommended to keep you safe.',
          '⑤ Bad words or photos can stay on the internet for a long time.',
        ]), CorrectAnswer: '④',
        Explanation: '④ Using real-time location tags is recommended to keep you safe.\n*해설: 본문은 안전을 위해 실시간 위치 태그를 "사용하지 말라"고 했으므로, 위치 태그를 권장한다는 ④는 일치하지 않는다.' } },
    ],
  },
];

// ───────────────────────── 실행 ─────────────────────────
const CIRCLED = ['①', '②', '③', '④', '⑤'];
function validate(q: Q): string[] {
  const errs: string[] = [];
  const qd = q.question_data;
  for (const k of ['Question', 'Paragraph', 'Options', 'CorrectAnswer', 'Explanation']) if (!qd[k]) errs.push(`${k} 없음`);
  const ca = String(qd.CorrectAnswer ?? '');
  if (!CIRCLED.includes(ca)) errs.push(`CorrectAnswer '${ca}' 는 ①~⑤ 하나여야 함`);
  const sep = q.type === '어휘' ? ' ### ' : '\n';
  const segs = String(qd.Options ?? '').split(sep).filter(Boolean);
  if (segs.length !== 5) errs.push(`Options 5개 아님(${segs.length})`);
  segs.forEach((s, i) => { if (!s.trim().startsWith(CIRCLED[i])) errs.push(`Options ${i + 1}번 접두 ${CIRCLED[i]} 아님`); });
  if (q.type === '빈칸' && !/<u>_{5,}<\/u>/.test(String(qd.Paragraph))) errs.push('빈칸 지문에 <u>___</u> 없음');
  if (q.type === '어휘') for (const c of CIRCLED) if (!String(qd.Paragraph).includes(c)) errs.push(`어휘 지문에 ${c} 표시 없음`);
  return errs;
}

async function main() {
  const totalQ = SETS.reduce((s, x) => s + x.items.length, 0);
  console.log(`대상: 성보람(${OWNER_LOGIN}) · 지문 ${PASSAGES.length}개 · 세트 ${SETS.length}개 · 문항 ${totalQ}개`);
  console.log(`모드: ${APPLY ? '★ APPLY' : 'dry-run(검증만)'}\n`);

  let bad = 0;
  for (const set of SETS) for (const q of set.items) {
    const e = validate(q);
    if (e.length) { bad++; console.log(`✗ [${set.folder}] ${q.passageKey} ${q.type}: ${e.join(' / ')}`); }
  }
  if (bad) { console.log(`\n검증 실패 ${bad}건 — 중단.`); process.exit(1); }
  console.log('✓ 전 문항 형식 검증 통과');

  if (!APPLY) {
    for (const set of SETS) console.log(`📁 ${set.folder}: ${set.items.map((q) => `${q.passageKey}/${q.type}`).join(', ')}`);
    console.log('\n실제 저장하려면 --apply');
    process.exit(0);
  }

  const db = await getDb('gomijoshua');
  await ensureQuestionBankIndexes(db);
  const owner = await db.collection('users').findOne({ loginId: OWNER_LOGIN }, { projection: { _id: 1 } });
  if (!owner) throw new Error('성보람 계정을 찾을 수 없습니다.');
  const userId = owner._id as ObjectId;

  const pid: Record<string, ObjectId> = {};
  for (const p of PASSAGES) {
    const existing = await db.collection('passages').findOne({ textbook: p.textbook, source_key: p.source }, { projection: { _id: 1 } });
    if (existing) { pid[p.key] = existing._id as ObjectId; continue; }
    const r = await db.collection('passages').insertOne({
      textbook: p.textbook, source_key: p.source, chapter: p.source, number: '',
      content: { original: p.original, translation: '', sentences_en: [], sentences_ko: [] },
      created_by: 'claude-code', createdAt: new Date(),
    });
    pid[p.key] = r.insertedId;
  }
  console.log(`passages 준비: ${Object.keys(pid).length}개`);

  const bank = db.collection(QUESTION_BANK_COLLECTION);
  let saved = 0, banked = 0;
  for (const set of SETS) {
    for (const q of set.items) {
      const res = await saveGeneratedQuestionToDb({
        passage_id: String(pid[q.passageKey]), textbook: set.textbook, source: set.source,
        type: q.type, option_type: 'English', status: '완료', question_data: q.question_data,
      });
      if (!res.ok) { console.log(`✗ 저장실패 [${set.folder}] ${q.passageKey}/${q.type}: ${res.error}`); continue; }
      saved++;
      const gq = await db.collection('generated_questions').findOne({ _id: new ObjectId(res.inserted_id) });
      const qd = (gq?.question_data ?? {}) as { Question?: string; Paragraph?: string };
      await bank.updateOne(
        { userId, questionId: new ObjectId(res.inserted_id) },
        { $setOnInsert: {
          userId, questionId: new ObjectId(res.inserted_id),
          serialNo: typeof gq?.serialNo === 'number' ? gq.serialNo : undefined,
          type: q.type, textbook: set.textbook, source: set.source,
          difficulty: String(gq?.difficulty ?? '중'),
          question: previewText(qd.Question, 90), preview: previewText(qd.Paragraph, 140),
          folder: set.folder, tags: [], savedAt: new Date(),
        } },
        { upsert: true },
      );
      banked++;
    }
    console.log(`📁 ${set.folder}: 저장·담김 완료`);
  }
  console.log(`\n✅ 완료: generated_questions ${saved}개 저장 · 내 문제 ${banked}개 담김(폴더 ${SETS.length}개)`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
