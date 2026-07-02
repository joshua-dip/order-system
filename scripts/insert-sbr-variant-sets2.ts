/**
 * 성보람 '내 문제' 배치2 — 시험 유형(일치/불일치/추론/어법 복수정답) 위주로 유형별 2개씩.
 * 기존 passages(배치1에서 생성)를 재사용. 어형변화 서술형은 별개 트랙이라 제외.
 *   npx tsx scripts/insert-sbr-variant-sets2.ts            # dry-run(검증)
 *   npx tsx scripts/insert-sbr-variant-sets2.ts --apply
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
const OWNER_LOGIN = '01091360422';
const TB_A = 'Recycling and Upcycling';
const TB_B = 'The World of SNS';

const A1 = `Many people want to protect the environment today. "Upcycling" and "recycling" are becoming popular words. Both aim to reduce waste. But they are not the same. Learning the differences is useful for people and businesses. It helps to make better choices for the environment. Recycling means breaking down waste materials. We use them to create new products. This helps to reduce the use of new resources and it also keeps waste away from landfills. For example, people enjoy putting plastic bottles into recycling bins. Some people like collecting old newspapers for recycling. Others try returning aluminum cans to recycling centers.`;
const A2 = `The recycling process has four steps. First, people collect materials from homes, businesses, or drop-off points. Next, workers sort items by type, such as plastic, paper, or metal. After they sort the items, they clean, shred, or melt the materials into raw materials. Finally, manufacturers use these raw materials to produce new products. Thanks to this process, recycling helps to conserve natural resources like timber, water, and minerals. It also helps to reduce energy consumption in manufacturing. In addition, recycling helps to decrease greenhouse gas emissions.`;
const A3 = `Upcycling means repurposing waste materials or unwanted items. We use them to create new products with higher value. Unlike recycling, upcycling keeps the original structure of materials. So upcycling does not need much processing. For example, people enjoy turning old wooden pallets into furniture. Some people like repurposing glass jars as storage containers or planters. Others try transforming outdated clothing into new fashion pieces or accessories. As a result, upcycling requires less energy than recycling because materials do not need breaking down. It also gives materials a new purpose and extends their life.`;
const B1 = `Today, many teenagers use social media (SNS) every day. It is very exciting, but we need to know the trends and the rules of social media. Teenagers love YouTube Shorts, Instagram Reels, and TikTok. They make 15-second videos. They dance, sing, or do fun missions to popular music with their friends. Students often go to photo booths to take pictures. They edit these photos with cool music or stickers. Then, they put them on their SNS stories.`;
const B2 = `Many students have a main account and a private account. On the private account, they only accept their close friends. They show their best friends their real everyday lives and honest feelings. Internet memes are also very popular. Students copy funny videos or famous phrases. They also use special AI filters. These filters change their faces into cartoon characters or funny styles. Then they share these photos with others.`;
const B3 = `SNS is a lot of fun, but it can cause problems, so we must remember some important rules. First, always ask for permission. When you upload a picture of your friend, you must ask, "Can I post this?" Second, never write bad things about a friend without a name, because everyone can still guess the friend. This is called "targeting," and it is a type of school violence. Third, remember digital footprints. Even on private accounts, someone can take a screenshot to spread your words forever. Finally, hide your personal information and do not use real-time location tags to stay safe.`;

// 어법-고난도용 밑줄 지문(밑줄 5개 중 2개 오류)
const A2_G = `The recycling process ①<u>has</u> four steps. First, people ②<u>collect</u> materials from homes, businesses, or drop-off points. Next, workers ③<u>sorts</u> items by type, such as plastic, paper, or metal. Finally, manufacturers ④<u>use</u> these raw materials to produce new products. Thanks to this process, recycling helps to ⑤<u>conserving</u> natural resources like timber, water, and minerals.`; // 오류 ③(sort) ⑤(conserve)
const A3_G = `Upcycling means ①<u>repurposing</u> waste materials or unwanted items. Unlike recycling, upcycling ②<u>keep</u> the original structure of materials. For example, people enjoy ③<u>turning</u> old wooden pallets into furniture. As a result, upcycling requires less energy because materials do not need ④<u>breaking</u> down. It also ⑤<u>give</u> materials a new purpose and extends their life.`; // 오류 ②(keeps) ⑤(gives)
const B1_G = `Today, many teenagers ①<u>use</u> social media every day. Teenagers ②<u>loves</u> YouTube Shorts, Instagram Reels, and TikTok. They ③<u>make</u> 15-second videos to popular music. Students often go to photo booths ④<u>to take</u> pictures. Then, they ⑤<u>putting</u> them on their SNS stories.`; // 오류 ②(love) ⑤(put)
const B3_G = `SNS is a lot of fun, but it ①<u>can</u> cause problems. When you ②<u>upload</u> a picture of your friend, you must ask permission. Everyone can still ③<u>guesses</u> the friend's name. Even on private accounts, someone can ④<u>take</u> a screenshot of your words. Bad jokes can ⑤<u>stays</u> on the internet forever.`; // 오류 ③(guess) ⑤(stay)

const nl = (o: string[]) => o.join('\n');
type Q = { pKey: string; source: string; type: string; question_data: Record<string, unknown> };
type Folder = { folder: string; textbook: string; items: Q[] };

// passage source_key (배치1과 동일)
const SRC: Record<string, string> = {
  A1: 'Recycling and Upcycling ①', A2: 'Recycling and Upcycling ②', A3: 'Recycling and Upcycling ③',
  B1: 'The World of SNS ①', B2: 'The World of SNS ②', B3: 'The World of SNS ③',
};

const stmt = (Question: string, Paragraph: string, opts: string[], CorrectAnswer: string, Explanation: string) =>
  ({ Question, Paragraph, Options: nl(opts), CorrectAnswer, Explanation });
const gram = (Paragraph: string, CorrectAnswer: string, Explanation: string) =>
  ({ Question: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것을 모두 고르시오.', Paragraph, CorrectAnswer, Explanation });

const FOLDERS: Folder[] = [
  { folder: '일치·불일치', textbook: TB_A, items: [
    { pKey: 'A1', source: TB_A, type: '일치', question_data: stmt('다음 글의 내용과 일치하는 것은?', A1, [
      '① Recycling and upcycling are exactly the same process.',
      '② Recycling breaks down waste materials to create new products.',
      '③ Recycling increases the use of new natural resources.',
      '④ People are not allowed to recycle plastic bottles at home.',
      '⑤ Collecting old newspapers has nothing to do with recycling.',
    ], '②', '② Recycling breaks down waste materials to create new products.\n*해설: 본문은 재활용이 폐기물을 분해해 새 제품을 만드는 것이라고 정의하므로 ②가 일치한다.') },
    { pKey: 'A2', source: TB_A, type: '일치', question_data: stmt('다음 글의 내용과 일치하는 것은?', A2, [
      '① The recycling process is finished after only one step.',
      '② Manufacturers throw away all the raw materials.',
      '③ Recycling increases greenhouse gas emissions.',
      '④ Workers sort the collected items by their type.',
      '⑤ Recycling raises the energy used in manufacturing.',
    ], '④', '④ Workers sort the collected items by their type.\n*해설: 본문에서 수거 후 작업자가 유형별로 분류한다고 했으므로 ④가 일치한다.') },
    { pKey: 'A2', source: TB_A, type: '불일치', question_data: stmt('다음 글의 내용과 일치하지 않는 것은?', A2, [
      '① Materials are collected before they are sorted.',
      '② Workers sort items such as plastic, paper, or metal.',
      '③ Manufacturers use raw materials to make new products.',
      '④ Recycling wastes natural resources like timber and water.',
      '⑤ Recycling helps to lower greenhouse gas emissions.',
    ], '④', '④ Recycling wastes natural resources like timber and water.\n*해설: 본문은 재활용이 목재·물·광물 같은 천연자원을 "보존"한다고 했으므로, 낭비한다는 ④는 일치하지 않는다.') },
    { pKey: 'A3', source: TB_A, type: '불일치', question_data: stmt('다음 글의 내용과 일치하지 않는 것은?', A3, [
      '① Upcycling repurposes waste or unwanted items.',
      '② Wooden pallets can become furniture through upcycling.',
      '③ Glass jars can be reused as storage containers.',
      '④ Upcycling gives materials a new purpose and extends their life.',
      '⑤ Upcycling needs much more processing than recycling.',
    ], '⑤', '⑤ Upcycling needs much more processing than recycling.\n*해설: 본문은 업사이클링이 많은 가공이 필요 없고 에너지가 적게 든다고 했으므로 ⑤는 일치하지 않는다.') },
  ] },
  { folder: '일치·불일치', textbook: TB_B, items: [
    { pKey: 'B1', source: TB_B, type: '일치', question_data: stmt('다음 글의 내용과 일치하는 것은?', B1, [
      '① Teenagers rarely use social media these days.',
      '② Short-form videos are usually about 15 seconds long.',
      '③ Students avoid editing their photo booth pictures.',
      '④ SNS stories cannot include music or stickers.',
      '⑤ Teenagers dislike YouTube Shorts and TikTok.',
    ], '②', '② Short-form videos are usually about 15 seconds long.\n*해설: 본문에서 15초짜리 영상을 만든다고 했으므로 ②가 일치한다.') },
    { pKey: 'B2', source: TB_B, type: '일치', question_data: stmt('다음 글의 내용과 일치하는 것은?', B2, [
      '① Private accounts accept anyone who sends a request.',
      '② Students never use AI filters on their photos.',
      '③ Close friends can see honest, everyday posts on private accounts.',
      '④ Internet memes are unpopular among students.',
      '⑤ AI filters can only make faces look older.',
    ], '③', '③ Close friends can see honest, everyday posts on private accounts.\n*해설: 비공개 계정에서는 친한 친구에게 솔직한 일상을 보여준다고 했으므로 ③이 일치한다.') },
    { pKey: 'B2', source: TB_B, type: '불일치', question_data: stmt('다음 글의 내용과 일치하지 않는 것은?', B2, [
      '① Some students keep both a main and a private account.',
      '② Private accounts are shared only with close friends.',
      '③ Students copy funny videos or famous phrases as memes.',
      '④ AI filters change faces into cartoon or funny styles.',
      '⑤ Students refuse to share filtered photos with anyone.',
    ], '⑤', '⑤ Students refuse to share filtered photos with anyone.\n*해설: 본문은 필터 사진을 다른 사람들과 "공유한다"고 했으므로 ⑤는 일치하지 않는다.') },
    { pKey: 'B3', source: TB_B, type: '불일치', question_data: stmt('다음 글의 내용과 일치하지 않는 것은?', B3, [
      '① You should get permission before posting a friend’s photo.',
      '② Targeting a friend online is a form of school violence.',
      '③ Location tags in real time are encouraged for safety.',
      '④ Words shared on private accounts can still spread.',
      '⑤ Hiding personal information helps keep you safe.',
    ], '③', '③ Location tags in real time are encouraged for safety.\n*해설: 본문은 안전을 위해 실시간 위치 태그를 사용하지 말라고 했으므로 ③은 일치하지 않는다.') },
  ] },
  { folder: '추론형', textbook: TB_A, items: [
    { pKey: 'A1', source: TB_A, type: '추론', question_data: stmt('다음 글에서 추론할 수 있는 것은?', A1, [
      '① Everyone dislikes recycling their household waste.',
      '② Reducing waste is impossible for ordinary people.',
      '③ People can take simple daily actions to help the environment.',
      '④ Recycling is only possible for large businesses.',
      '⑤ Plastic bottles cannot be recycled at all.',
    ], '③', '③ People can take simple daily actions to help the environment.\n*해설: 페트병·신문·캔을 모으는 일상적 예시로 보아, 개인이 간단한 실천으로 환경을 도울 수 있음을 추론할 수 있다.') },
    { pKey: 'A3', source: TB_A, type: '추론', question_data: stmt('다음 글에서 추론할 수 있는 것은?', A3, [
      '① Upcycling always costs more money than recycling.',
      '② Old clothing must be thrown away immediately.',
      '③ Upcycling damages the environment more than recycling.',
      '④ Creativity can turn unwanted items into useful things.',
      '⑤ Materials can be used only once before disposal.',
    ], '④', '④ Creativity can turn unwanted items into useful things.\n*해설: 팔레트→가구, 유리병→수납함 등의 예시로 보아, 창의력으로 버려질 물건을 유용하게 바꿀 수 있음을 추론할 수 있다.') },
  ] },
  { folder: '추론형', textbook: TB_B, items: [
    { pKey: 'B1', source: TB_B, type: '추론', question_data: stmt('다음 글에서 추론할 수 있는 것은?', B1, [
      '① Teenagers use social media only for schoolwork.',
      '② Music and creativity play a big role in SNS trends.',
      '③ Photo booths are being replaced by smartphones.',
      '④ Making videos requires expensive professional gear.',
      '⑤ Teenagers avoid sharing anything on their stories.',
    ], '②', '② Music and creativity play a big role in SNS trends.\n*해설: 인기 음악에 맞춰 영상을 만들고 사진을 꾸며 공유한다는 내용으로 보아, 음악과 창의성이 유행에서 큰 역할을 함을 추론할 수 있다.') },
    { pKey: 'B3', source: TB_B, type: '추론', question_data: stmt('다음 글에서 추론할 수 있는 것은?', B3, [
      '① Once posted online, content may be impossible to erase.',
      '② Private accounts guarantee complete online safety.',
      '③ Sharing your location always makes you safer.',
      '④ Targeting has no real effect on friends.',
      '⑤ Asking permission before posting is unnecessary.',
    ], '①', '① Once posted online, content may be impossible to erase.\n*해설: 비공개 계정이라도 캡처로 영원히 퍼질 수 있다고 했으므로, 한 번 올린 내용은 지우기 어려울 수 있음을 추론할 수 있다.') },
  ] },
  { folder: '어법 복수정답', textbook: TB_A, items: [
    { pKey: 'A2', source: TB_A, type: '어법-고난도', question_data: gram(A2_G, '③⑤',
      '정답 ③⑤. ③ 주어 workers(복수)에 맞춰 sorts → sort, ⑤ helps to 뒤에는 동사원형이 와야 하므로 conserving → conserve.') },
    { pKey: 'A3', source: TB_A, type: '어법-고난도', question_data: gram(A3_G, '②⑤',
      '정답 ②⑤. ② 주어 upcycling(단수)에 맞춰 keep → keeps, ⑤ 주어 It에 맞춰 give → gives.') },
  ] },
  { folder: '어법 복수정답', textbook: TB_B, items: [
    { pKey: 'B1', source: TB_B, type: '어법-고난도', question_data: gram(B1_G, '②⑤',
      '정답 ②⑤. ② 주어 Teenagers(복수)에 맞춰 loves → love, ⑤ 앞의 they에 맞춰 등위로 동사 putting → put.') },
    { pKey: 'B3', source: TB_B, type: '어법-고난도', question_data: gram(B3_G, '③⑤',
      '정답 ③⑤. ③ can 뒤에는 동사원형이므로 guesses → guess, ⑤ can 뒤에는 동사원형이므로 stays → stay.') },
  ] },
];

const CIRCLED = ['①', '②', '③', '④', '⑤'];
function validate(q: Q): string[] {
  const e: string[] = []; const qd = q.question_data;
  for (const k of ['Question', 'Paragraph', 'CorrectAnswer', 'Explanation']) if (!qd[k]) e.push(`${k} 없음`);
  const ca = String(qd.CorrectAnswer ?? '');
  if (q.type === '어법-고난도') {
    if (!/^[①②③④⑤]{2,5}$/.test(ca)) e.push(`어법 복수정답 CA '${ca}' 형식오류`);
    for (const c of CIRCLED) if (!String(qd.Paragraph).includes(`${c}<u>`)) e.push(`지문에 ${c}<u> 없음`);
  } else {
    if (!CIRCLED.includes(ca)) e.push(`CA '${ca}' ①~⑤ 아님`);
    const segs = String(qd.Options ?? '').split('\n').filter(Boolean);
    if (segs.length !== 5) e.push(`Options 5개 아님(${segs.length})`);
    segs.forEach((s, i) => { if (!s.trim().startsWith(CIRCLED[i])) e.push(`Opt${i + 1} 접두오류`); });
  }
  return e;
}

async function main() {
  const all = FOLDERS.flatMap((f) => f.items);
  console.log(`대상: 성보람(${OWNER_LOGIN}) · 문항 ${all.length}개 · ${APPLY ? '★APPLY' : 'dry-run'}\n`);
  let bad = 0;
  for (const f of FOLDERS) for (const q of f.items) { const er = validate(q); if (er.length) { bad++; console.log(`✗ ${q.pKey} ${q.type}: ${er.join(' / ')}`); } }
  if (bad) { console.log(`\n검증 실패 ${bad} — 중단`); process.exit(1); }
  console.log('✓ 형식 검증 통과');
  const byFolder: Record<string, number> = {};
  for (const f of FOLDERS) byFolder[f.folder] = (byFolder[f.folder] ?? 0) + f.items.length;
  Object.entries(byFolder).forEach(([k, v]) => console.log(`📁 ${k}: ${v}`));
  if (!APPLY) { console.log('\n--apply 로 저장'); process.exit(0); }

  const db = await getDb('gomijoshua');
  await ensureQuestionBankIndexes(db);
  const owner = await db.collection('users').findOne({ loginId: OWNER_LOGIN }, { projection: { _id: 1 } });
  if (!owner) throw new Error('성보람 없음');
  const userId = owner._id as ObjectId;

  const pid: Record<string, ObjectId> = {};
  for (const [k, src] of Object.entries(SRC)) {
    const tb = k.startsWith('A') ? TB_A : TB_B;
    const p = await db.collection('passages').findOne({ textbook: tb, source_key: src }, { projection: { _id: 1 } });
    if (!p) throw new Error(`passage 없음: ${src} — 배치1을 먼저 실행하세요.`);
    pid[k] = p._id as ObjectId;
  }

  const bank = db.collection(QUESTION_BANK_COLLECTION);
  let saved = 0, banked = 0;
  for (const f of FOLDERS) {
    for (const q of f.items) {
      const res = await saveGeneratedQuestionToDb({
        passage_id: String(pid[q.pKey]), textbook: f.textbook, source: q.source,
        type: q.type, option_type: 'English', status: '완료', question_data: q.question_data,
      });
      if (!res.ok) { console.log(`✗ 저장실패 ${q.pKey}/${q.type}: ${res.error}`); continue; }
      saved++;
      const gq = await db.collection('generated_questions').findOne({ _id: new ObjectId(res.inserted_id) });
      const qd = (gq?.question_data ?? {}) as { Question?: string; Paragraph?: string };
      await bank.updateOne({ userId, questionId: new ObjectId(res.inserted_id) }, { $setOnInsert: {
        userId, questionId: new ObjectId(res.inserted_id), serialNo: typeof gq?.serialNo === 'number' ? gq.serialNo : undefined,
        type: q.type, textbook: f.textbook, source: q.source, difficulty: String(gq?.difficulty ?? '중'),
        question: previewText(qd.Question, 90), preview: previewText(qd.Paragraph, 140),
        folder: f.folder, tags: [], savedAt: new Date(),
      } }, { upsert: true });
      banked++;
    }
  }
  console.log(`\n✅ 저장 ${saved} · 담김 ${banked}`);
  process.exit(0);
}
main().catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
