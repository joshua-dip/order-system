/**
 * 26년 6월 고2 — 한글 선택지 영어 재작성 배치 1: 18·19·20번 27건 (2026-06-13).
 * 정합 검증(hangul_options_in_english_type) 백로그 225건 중 1차분.
 * 원문 대조로 참/거짓 의미 보존, 정답 슬롯·한글 해설 유지.
 * 사용: npx tsx scripts/patch-26-06-go2-options-eng-b1-20260613.ts [--apply]
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
  // ── 18번 (Science Fair)
  {
    id: '6a21b4de671ee125f5664549', type: '불일치', ca: '④', mustInclude: '다음 달에 처음 공지될 예정이다',
    options: [
      'The science fair is scheduled to be held on July 18.',
      "The theme of the fair is 'Sustainable Future.'",
      'Student registration is lower than expected.',
      'The fair will be announced for the first time next month.',
      'Students can present projects related to environmental conservation or renewable energy.',
    ],
  },
  {
    id: '6a21b4de671ee125f566454a', type: '불일치', ca: '⑤', mustInclude: '직접 방문하여 제출해야 한다',
    options: [
      'More students are being encouraged to take part in the fair.',
      'Participants can present a project, an experiment, or a model.',
      'There is an opportunity to showcase work for teachers, peers, and local scientists.',
      'A brief description of the work must be submitted by June 25.',
      'The description must be submitted in person.',
    ],
  },
  {
    id: '6a21b4de671ee125f566454b', type: '불일치', ca: '④', mustInclude: '학부모도 포함된다',
    options: [
      'The fair is an annual event.',
      'Since registration is lower than expected, more students are being encouraged to participate.',
      'Topics to present are related to environmental conservation or renewable energy.',
      'Parents are included in the audience for the presentations.',
      'The letter was written by Mr. Howard, a science teacher.',
    ],
  },
  {
    id: '6a21b4df671ee125f566455b', type: '일치', ca: '①', mustInclude: '예상보다 활발하게',
    options: [
      "The theme of the fair is 'Sustainable Future.'",
      'The fair is scheduled to be held on June 25.',
      'The fair was announced for the first time this month.',
      'Student registration is more active than expected.',
      'Presentation materials can be submitted by next month.',
    ],
  },
  {
    id: '6a21b4df671ee125f566455c', type: '일치', ca: '②', mustInclude: '격년으로 열리는',
    options: [
      'The fair is held every two years.',
      'Works related to environmental conservation or renewable energy can be presented.',
      'Registration has closed because more students applied than expected.',
      'The audience for the presentations is limited to teachers.',
      'The letter was written by the school principal.',
    ],
  },
  {
    id: '6a21b4df671ee125f566455d', type: '일치', ca: '③', mustInclude: '완성된 논문을 제출해야',
    options: [
      'The fair will be held in August.',
      'Participants must submit a completed paper.',
      'Interested students should submit a brief description of their work.',
      'The fair is closed to anyone outside the school.',
      'This is the first time the fair is being held.',
    ],
  },
  {
    id: '6a21b4df671ee125f5664564', type: '주제', ca: '①', mustInclude: '수상자 선정 기준 발표',
    options: [
      'a notice encouraging participation in a science fair',
      'the need for sustainable energy policies',
      'everyday practices for environmental conservation',
      'an announcement of the judging criteria for science fair winners',
      'a proposal for joint research with local scientists',
    ],
  },
  {
    id: '6a21b4df671ee125f5664565', type: '주제', ca: '④', mustInclude: '신입 회원 모집',
    options: [
      'recent trends in renewable energy technology',
      'a notice about changes to the fair schedule',
      'recruitment of new members for a school science club',
      'an invitation encouraging students to join a science fair',
      'a warning about the seriousness of environmental pollution',
    ],
  },
  {
    id: '6a21b4df671ee125f5664566', type: '주제', ca: '③', mustInclude: '공정성 강조',
    options: [
      'suggestions for lifestyle habits for a sustainable future',
      'tips for writing a science experiment report',
      'a request for more students to participate in a science fair',
      'a notice about an invited lecture by local scientists',
      "an emphasis on fairness in selecting the fair's theme",
    ],
  },
  // ── 19번 (Luna's cake)
  {
    id: '6a2222158d91251beb10f312', type: '불일치', ca: '③', mustInclude: '60번째 생일이라고 적혀',
    options: [
      "Luna went to pick up a cake for her dad's 70th birthday.",
      'When she opened the box, there was a lemon cake inside.',
      'The message on top of the cake said it was for a 60th birthday.',
      'Luna wondered if she had made a mistake when ordering.',
      'The baker explained that they had received two similar orders.',
    ],
  },
  {
    id: '6a2222158d91251beb10f313', type: '불일치', ca: '④', mustInclude: '그 자리에 계속 서 있었다',
    options: [
      'What Luna ordered was a chocolate cake.',
      "Luna couldn't understand what she saw when she opened the box.",
      'Luna told the baker that the flavor and the message were wrong.',
      'The baker asked her to wait and remained standing there.',
      'Luna was sure she had chosen a quality bakery.',
    ],
  },
  {
    id: '6a2222158d91251beb10f314', type: '불일치', ca: '④', mustInclude: '환불을 요구하며 빵집을 떠났다',
    options: [
      "The cake Luna went to pick up was for her dad's birthday.",
      'When she opened the box, the flavor of the cake was different from what she had ordered.',
      'The baker returned with her cake moments later.',
      'Luna ended up leaving the bakery demanding a refund.',
      'Luna said the cake looked even better than she had imagined.',
    ],
  },
  {
    id: '6a2222168d91251beb10f324', type: '일치', ca: '①', mustInclude: '직접 케이크를 다시 만들라고',
    options: [
      "Luna went to pick up a cake for her dad's 70th birthday.",
      'There was a chocolate cake inside the box when she opened it.',
      'The message on the cake celebrated a 60th birthday.',
      'Luna was sure that she had made a mistake with her order.',
      'The baker asked Luna to make the cake again herself.',
    ],
  },
  {
    id: '6a2222168d91251beb10f325', type: '일치', ca: '③', mustInclude: '끝까지 돌아오지 않았다',
    options: [
      "Luna ordered a cake for her dad's 60th birthday.",
      'Luna immediately understood what she saw inside the box.',
      'The baker explained that they had received two similar orders.',
      'The baker never came back.',
      'Luna regretted her choice of bakery.',
    ],
  },
  {
    id: '6a2222168d91251beb10f326', type: '일치', ca: '②', mustInclude: '환불을 제안했다',
    options: [
      'There was a chocolate cake inside the box.',
      'Luna told the baker that both the flavor and the message were wrong.',
      "The message celebrated her dad's 70th birthday.",
      'The baker offered Luna a refund.',
      'Luna said the cake she received fell short of her expectations.',
    ],
  },
  {
    id: '6a2222168d91251beb10f32d', type: '주제', ca: '①', mustInclude: '직원 교육의 중요성',
    options: [
      "a customer's response of keeping trust in a bakery despite a mixed-up order",
      'various ways to make a birthday cake at home',
      'the importance of staff training in running a bakery',
      'traditional ways of celebrating family birthdays',
      'changing consumer preferences for cake flavors',
    ],
  },
  {
    id: '6a2222168d91251beb10f32e', type: '주제', ca: '③', mustInclude: '신선도 유지를 위한 요령',
    options: [
      'tips for storing cakes and keeping them fresh',
      'a comparison of lemon and chocolate cake flavors',
      'a bakery experience in which a mixed-up order was corrected and trust was restored',
      "the effect of a bakery's location on its sales",
      'the difficulty of writing birthday messages correctly',
    ],
  },
  {
    id: '6a2222168d91251beb10f32f', type: '주제', ca: '④', mustInclude: '가격 협상에서',
    options: [
      'the attitude customers should take when negotiating cake prices',
      'various expressions for birthday greetings',
      'hygiene problems that often occur in bakeries',
      "a customer's feelings turning into satisfaction as a mistake is resolved",
      'effective ways to learn baking skills',
    ],
  },
  // ── 20번 (Fallacy of composition)
  {
    id: '6a2222168d91251beb10f336', type: '불일치', ca: '②', mustInclude: '반드시 생산적이고 효율적이게 된다',
    options: [
      'We can sometimes assume that the whole will be as good as each of its parts.',
      'If everyone brought on board is productive and efficient, the startup will necessarily be productive and efficient as well.',
      'The fallacy of composition fails to allow for how the different parts interact with each other.',
      'A unit composed of good people can still be working on a doomed project.',
      'When assembling a team with a common goal, the overall view should always be checked.',
    ],
  },
  {
    id: '6a2222168d91251beb10f337', type: '불일치', ca: '④', mustInclude: '개개인만 확인하면 충분하다',
    options: [
      'If the efficient administrator and the head of IT each assumes the other is checking the prototype test results, a problem arises.',
      'A project composed of good ideas may lack a stable center.',
      'The fallacy of composition fails to consider the interaction between parts.',
      'When assembling a team, checking the individuals involved is enough.',
      'A situation where the head of a startup assumes everyone on board is productive and efficient is given as an example.',
    ],
  },
  {
    id: '6a2222178d91251beb10f338', type: '불일치', ca: '②', mustInclude: '상호작용하는지를 고려한다',
    options: [
      'A team composed of good people may still be working on a doomed project.',
      'The fallacy of composition takes into account how different parts interact with each other.',
      'The assumption that the whole will be as good as its parts is not always true.',
      'Even a project composed of good ideas may lack a stable center.',
      'When assembling a team, the overall view as well as the individuals should be checked.',
    ],
  },
  {
    id: '6a2222178d91251beb10f348', type: '일치', ca: '①', mustInclude: '진행할 수 없다',
    options: [
      'The fallacy of composition fails to allow for how the parts interact with each other.',
      'If all the members are productive and efficient, the whole is necessarily so as well.',
      'A team of good people cannot be working on a doomed project.',
      'A project composed of good ideas always has a stable center.',
      'Checking only the individuals involved is enough when assembling a team.',
    ],
  },
  {
    id: '6a2222178d91251beb10f349', type: '일치', ca: '②', mustInclude: '합보다 더 우수하다',
    options: [
      'The whole is always better than the sum of its parts.',
      'A problem arises if the administrator and the head of IT each assumes the other is in charge of collating the prototype test results.',
      "Gathering only efficient members automatically guarantees the startup's efficiency.",
      'In a team with a common goal, individual ability comes before the overall view.',
      'A project composed of good ideas never loses its center.',
    ],
  },
  {
    id: '6a2222178d91251beb10f34a', type: '일치', ca: '③', mustInclude: '절대 모이지 않는다',
    options: [
      'The fallacy of composition accurately reflects the interaction between parts.',
      'A startup made up of productive members is necessarily productive.',
      'When assembling a team, the overall view as well as the individuals involved should always be checked.',
      'Good people never gather around a doomed project.',
      'The assumption that good parts make a good whole is always correct.',
    ],
  },
  {
    id: '6a2222188d91251beb10f351', type: '주제', ca: '①', mustInclude: '체계적인 면접 절차',
    options: [
      'why a collection of excellent individuals does not guarantee an excellent whole',
      "the decisive influence of an efficient administrator on a startup's success",
      'the need for a systematic interview process in hiring talent',
      'why setting a common goal improves team productivity',
      'the importance of dividing the work of collating prototype test results',
    ],
  },
  {
    id: '6a2222188d91251beb10f352', type: '주제', ca: '③', mustInclude: '조기에 중단해야',
    options: [
      'strategies for recruiting key talent for a fast-growing startup',
      'how good ideas come together to form a stable center',
      'why the excellence of the parts does not guarantee the excellence of the whole',
      'communication techniques for clarifying who is responsible for what',
      'the need to stop a doomed project at an early stage',
    ],
  },
  {
    id: '6a2222188d91251beb10f353', type: '주제', ca: '④', mustInclude: '위험 관리의 중요성',
    options: [
      "how efficient employees increase a startup's productivity",
      'the importance of risk management in preventing project failure',
      'ways to build an organizational culture that maximizes individual ability',
      'the need to examine a team from an overall view rather than its parts',
      'why clear division of roles determines the efficiency of collaboration',
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
    report.push({ id: f.id, source: doc.source, type: f.type, ca: f.ca, action: APPLY ? '교체' : '교체 예정' });
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
