/**
 * 파이널 예비 모의고사 (양정고1 · 26.06.28. · 30문항) 부족 3문항 제작.
 *  - 함의: 24년 9월 고1 영어모의고사 24번 (69c4ffc346f58f933b6dce65)
 *  - 삽입: 25년 3월 고1 영어모의고사 30번 (69c4ffc446f58f933b6dce9d)
 *  - 삽입: 25년 3월 고1 영어모의고사 35번 (69c4ffc446f58f933b6dcea2)
 *
 * 기본: 검증만(저장 안 함). `--commit` 플래그가 있으면 status=완료·English 로 저장 후
 * refillJobShortages 로 잡(6a40b142e873b83a0b26960d)을 ready 로 전환.
 * 비밀(MONGODB_URI 등) 미출력.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { checkContentIntegrity } from '../lib/content-integrity-validation';
import { runPerQuestionValidations, hasBlockingIssue } from '../lib/variant-review-validators';
import { saveGeneratedQuestionToDb } from '../lib/variant-save-generated-question';
import {
  FINAL_EXAM_JOBS_COLLECTION,
  refillJobShortages,
  type FinalExamJobDoc,
} from '../lib/final-exam-store';

const JOB_ID = '6a40b142e873b83a0b26960d';
const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** lib/hard-insertion-generator.ts buildMarkedParagraph 와 동일 규칙(미export 라 복제). */
function buildMarkedParagraph(sentences: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i > 0 && i <= 5) parts.push(CIRCLED[i - 1]);
    parts.push(sentences[i]);
  }
  if (sentences.length <= 5) parts.push(CIRCLED[Math.min(sentences.length - 1, 4)]);
  return parts.join(' ');
}

/** 추출형 삽입: 원문에서 removeIndex 문장을 빼 주어진 문장으로, 나머지를 본문으로. 정답 = CIRCLED[removeIndex-1]. */
function buildInsertion(sentences: string[], removeIndex: number, explanation: string, source: string) {
  if (removeIndex < 1 || removeIndex > 5) throw new Error(`removeIndex ${removeIndex} 범위 밖(1~5)`);
  const given = sentences[removeIndex];
  const body = sentences.filter((_, i) => i !== removeIndex);
  const answer = CIRCLED[removeIndex - 1];
  const paragraph = `${given}\n###\n${buildMarkedParagraph(body)}`;
  return {
    Question: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
    Paragraph: paragraph,
    Options: '①\n②\n③\n④\n⑤',
    OptionType: 'English',
    CorrectAnswer: answer,
    Explanation: explanation,
    Source: source,
    Category: '삽입',
  };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const db = await getDb('gomijoshua');
  const passagesCol = db.collection('passages');

  async function sentencesOf(id: string): Promise<string[]> {
    const p = await passagesCol.findOne(
      { _id: new ObjectId(id) },
      { projection: { 'content.sentences_en': 1, 'content.original': 1 } },
    );
    const arr = (p?.content?.sentences_en ?? []) as string[];
    if (!arr.length) throw new Error(`passage ${id} sentences_en 비어 있음`);
    return arr;
  }
  async function originalOf(id: string): Promise<string> {
    const p = await passagesCol.findOne({ _id: new ObjectId(id) }, { projection: { 'content.original': 1 } });
    return String(p?.content?.original ?? '');
  }

  /* ── Draft 1: 함의 (24년 9월 24번) ── */
  const HAMI_ID = '69c4ffc346f58f933b6dce65';
  const HAMI_PHRASE = 'the marine equivalent of thousands of trees';
  const hamiOriginal = await originalOf(HAMI_ID);
  if (!hamiOriginal.includes(HAMI_PHRASE)) throw new Error('함의 밑줄 구절을 원문에서 찾지 못함');
  const hamiParagraph = hamiOriginal.replace(HAMI_PHRASE, `<u>${HAMI_PHRASE}</u>`);
  const draftHami = {
    passage_id: HAMI_ID,
    textbook: '24년 9월 고1 영어모의고사',
    source: '24년 9월 고1 영어모의고사 24번',
    type: '함의',
    option_type: 'English',
    question_data: {
      Question: `밑줄 친 "${HAMI_PHRASE}"이 다음 글에서 의미하는 바로 가장 적절한 것은?`,
      Paragraph: hamiParagraph,
      Options:
        '① as effective as thousands of trees at removing carbon from the air' +
        ' ### ② as numerous in the ocean as the trees that fill a large forest' +
        ' ### ③ as old and slow-growing as thousands of forest trees' +
        ' ### ④ as widespread across the planet as forests are across land' +
        ' ### ⑤ as harmful to the climate as the loss of thousands of trees',
      OptionType: 'English',
      CorrectAnswer: '①',
      Explanation:
        "밑줄 친 부분은 탄소 저장의 관점에서 고래 한 마리가 수천 그루의 나무에 맞먹는 존재라는 뜻이다. " +
        '바로 앞에서 고래 한 마리는 죽을 때 평균 30톤의 이산화탄소를 격리하는 반면 나무 한 그루는 연간 48파운드만 흡수한다고 비교하고 있으므로, ' +
        '고래가 대기 중 탄소를 제거하는 데 있어 수천 그루의 나무만큼 효과적이라는 의미다. ' +
        "따라서 ① 'as effective as thousands of trees at removing carbon from the air'가 가장 적절하다.",
      Source: '24년 9월 고1 영어모의고사 24번',
      Category: '함의',
    },
  };

  /* ── Draft 2: 삽입 (25년 3월 30번) — "By doing so..." 추출 → 정답 ② ── */
  const SAP30_ID = '69c4ffc446f58f933b6dce9d';
  const sap30 = await sentencesOf(SAP30_ID);
  const draftSap30 = {
    passage_id: SAP30_ID,
    textbook: '25년 3월 고1 영어모의고사',
    source: '25년 3월 고1 영어모의고사 30번',
    type: '삽입',
    option_type: 'English',
    question_data: buildInsertion(
      sap30,
      2,
      '②이 정답입니다. 이 글은 프로모션이 소비자 심리를 다루며, 가장 명확하고 정직하며 단순한 방식으로 정보를 제공하는 수단이라고 설명한 뒤, ' +
        '과거처럼 소비자를 속이던 방식은 사라지고 이제는 가치를 알아볼 소비자를 찾아 그 가치를 분명히 전달하는 것이 목표가 되었다는 흐름으로 전개된다. ' +
        "주어진 문장의 'By doing so(그렇게 함으로써)'는 앞 문장의 '가장 명확하고 정직하며 단순하게 정보를 제공하는 것'을 가리키며, 그 결과로 매출 증가 가능성이 높아진다는 내용이다. " +
        "바로 뒤 문장은 'Gone are the days~'로 소비자를 속이던 시대가 끝났다는 새로운 화제를 시작하므로, 주어진 문장은 정보 제공 방식을 설명한 문장과 새 화제 사이인 ② 위치가 가장 적절하다.",
      '25년 3월 고1 영어모의고사 30번',
    ),
  };

  /* ── Draft 3: 삽입 (25년 3월 35번) — "Violent action films..." 추출 → 정답 ④ ── */
  const SAP35_ID = '69c4ffc446f58f933b6dcea2';
  const sap35 = await sentencesOf(SAP35_ID);
  const draftSap35 = {
    passage_id: SAP35_ID,
    textbook: '25년 3월 고1 영어모의고사',
    source: '25년 3월 고1 영어모의고사 35번',
    type: '삽입',
    option_type: 'English',
    question_data: buildInsertion(
      sap35,
      4,
      "④이 정답입니다. 이 글은 작가가 주인공과 관객 사이에 긍정적 관계를 세워 관객이 주인공을 '친구'로 인식하게 만들어야 비극이나 불행에서 강한 감정 반응이 나온다는 점을 설명한다. " +
        '주어진 문장은 폭력적인 액션 영화에서 비중 낮은 인물들의 죽음이 관객의 반응을 거의 끌어내지 못한다(draw out little response)는 대조적 사례로, ' +
        '우리가 감정적으로 몰입하는 주인공(앞 문장: 가치 있는 협력자)과, 강한 감정을 느끼려면 등장인물에게 협력자나 적으로 몰입해야 한다는 결론(뒤 문장: strong emotions) 사이를 잇는다. ' +
        '반응이 약한 인물(주어진 문장)과 강한 감정(뒤 문장)의 대비가 핵심이므로 ④ 위치가 가장 적절하다.',
      '25년 3월 고1 영어모의고사 35번',
    ),
  };

  const drafts = [draftHami, draftSap30, draftSap35];

  let blocked = false;
  for (const d of drafts) {
    console.log('\n════════════════════════════════════════════');
    console.log(`[${d.type}] ${d.source}  (passage ${d.passage_id})`);
    console.log('Question:', (d.question_data as Record<string, unknown>).Question);
    console.log('CorrectAnswer:', (d.question_data as Record<string, unknown>).CorrectAnswer);
    const para = String((d.question_data as Record<string, unknown>).Paragraph ?? '');
    const markerCount = (para.match(/[①②③④⑤]/g) ?? []).length;
    console.log(`Paragraph (markers=${markerCount}):`);
    console.log(para);
    console.log('Options:', (d.question_data as Record<string, unknown>).Options);

    const ci = checkContentIntegrity({ type: d.type, question_data: d.question_data, option_type: d.option_type });
    const pq = await runPerQuestionValidations(db, { type: d.type, question_data: d.question_data, passage_id: new ObjectId(d.passage_id) });
    const all = [...ci, ...pq];
    if (all.length === 0) {
      console.log('검증: ✅ 이슈 없음');
    } else {
      for (const i of all) console.log(`검증: [${i.severity}] ${i.rule} — ${i.message}`);
      if (hasBlockingIssue(all as Parameters<typeof hasBlockingIssue>[0])) blocked = true;
    }
  }

  if (blocked) {
    console.log('\n❌ error 이슈가 있어 저장하지 않습니다. 위 항목을 수정하세요.');
    process.exit(1);
  }
  console.log('\n✅ 전체 검증 통과.');

  if (!commit) {
    console.log('(검증 모드 — 저장하려면 --commit 추가)');
    process.exit(0);
  }

  console.log('\n── 저장(status=완료, English) ──');
  for (const d of drafts) {
    const res = await saveGeneratedQuestionToDb({
      passage_id: d.passage_id,
      textbook: d.textbook,
      source: d.source,
      type: d.type,
      question_data: d.question_data,
      status: '완료',
      option_type: 'English',
    });
    if (!res.ok) { console.log(`  ❌ ${d.source}: ${res.error}`); process.exit(1); }
    console.log(`  ✅ ${d.type} ${d.source} → ${res.inserted_id} (status=${res.status})`);
  }

  console.log('\n── refillJobShortages ──');
  const job = await db
    .collection<FinalExamJobDoc>(FINAL_EXAM_JOBS_COLLECTION)
    .findOne({ _id: new ObjectId(JOB_ID) as unknown as FinalExamJobDoc['_id'] });
  if (!job) { console.log('잡을 찾지 못함'); process.exit(1); }
  const updated = await refillJobShortages(db, job);
  const remaining = updated.items.filter((it) => it.shortBy > 0);
  console.log(`잡 status=${updated.status}  남은 shortBy>0=${remaining.length}건  totalAssigned=${(updated as unknown as Record<string, unknown>).totalAssigned}`);
  for (const it of remaining) console.log(`  남음: ${it.type} ${it.sourceKey} shortBy=${it.shortBy}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
