/**
 * UV-20260623-001 보정 (1회용): UNIT 18 05번 삽입 3문항.
 * 이 지문은 5문장이라 한 문장을 빼면 본문 마커가 4개(①~④)뿐 → content-integrity
 * paragraph_marker_count(5개 필요) 위반. 5문장을 모두 본문에 두고(마커 ①~⑤)
 * "주어진 문장"을 새 브릿지 문장으로 만드는 표준 기법(hard-insertion)으로 교체한다.
 * read-only 아님 — 알려진 _id 3건에 한해 updateOne 패치 (재저장/중복 금지).
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

// 5문장 전체를 본문에 두고 ①~⑤ 마커 부여 (S0 ① S1 ② S2 ③ S3 ④ S4 ⑤)
const MARKED_BODY = [
  'Over the last several decades, scholars have developed standards for how best to create, organize, present, and preserve digital information for future generations.',
  '①',
  'What has remained neglected for the most part, however, are the needs of people with disabilities.',
  '②',
  'As a result, many of the otherwise most valuable digital resources are useless for people who are deaf or hard of hearing, as well as for people who are blind, have low vision, or have difficulty distinguishing particular colors.',
  '③',
  'While professionals working in educational technology and commercial web design have made significant progress in meeting the needs of such users, some scholars creating digital projects all too often fail to take these needs into account.',
  '④',
  'This situation would be much improved if more projects embraced the idea that we should always keep the largest possible audience in mind as we make design decisions, ensuring that our final product serves the needs of those with disabilities as well as those without.',
  '⑤',
].join(' ');

const PATCHES: Array<{ id: string; given: string; answer: string; explanation: string }> = [
  {
    id: '6a3a6e9c6ce07f9138be10a9',
    answer: '②',
    given:
      'Such disregard for these users is troubling, since they make up a substantial share of the people any digital project hopes to reach.',
    explanation:
      "②가 정답입니다. 이 글은 디지털 정보 표준에서 장애가 있는 사람들의 요구가 무시되어 온 문제와 그 개선 방안을 다룹니다. ② 앞 문장은 장애인의 요구가 대체로 무시되어 왔다는 내용이고, 주어진 문장의 'Such disregard for these users(이러한 사용자에 대한 무시)'가 이를 직접 받아 그들이 디지털 프로젝트가 도달하려는 사람의 상당 부분임을 지적합니다. ② 뒤 문장은 'As a result(그 결과)' 그 무시로 자원이 무용지물이 된다고 이어지므로, 주어진 문장은 ②에 들어가야 합니다.",
  },
  {
    id: '6a3a6ea26ce07f9138be10aa',
    answer: '③',
    given:
      'These shortcomings are not inevitable, however, as certain communities of practice working with digital media have already shown otherwise.',
    explanation:
      "③이 정답입니다. ③ 앞 문장은 장애가 있는 사람들에게 많은 디지털 자원이 무용지물이 된다는 문제점입니다. 주어진 문장의 'These shortcomings(이러한 결함)'가 이 문제들을 받아, 그것이 불가피한 것은 아니라고 말합니다. ③ 뒤 문장은 일부 전문가 집단이 이미 사용자 요구 충족에 상당한 진전을 이뤘다는 내용으로, 결함이 불가피하지 않음을 보여 준 사례에 해당하므로 주어진 문장은 ③에 들어가야 합니다.",
  },
  {
    id: '6a3a6ea96ce07f9138be10ab',
    answer: '④',
    given:
      'This uneven record shows that good intentions alone are not enough to guarantee accessible results across the board.',
    explanation:
      "④가 정답입니다. ④ 앞 문장은 전문가들은 진전을 이뤘지만 일부 학자들은 장애인의 요구를 고려하지 못한다는 엇갈린 상황입니다. 주어진 문장의 'This uneven record(이러한 고르지 못한 실적)'가 이 대비를 받아, 좋은 의도만으로는 누구에게나 접근 가능한 결과를 보장하지 못한다고 정리합니다. ④ 뒤 문장은 'This situation would be much improved(이러한 상황은 개선될 것이다)'로 개선 방안을 제시하므로, 주어진 문장은 ④에 들어가야 합니다.",
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const p of PATCHES) {
    const _id = new ObjectId(p.id);
    const doc = await col.findOne({ _id });
    if (!doc) {
      console.error('없음:', p.id);
      continue;
    }
    if (doc.type !== '삽입' || doc.source !== 'UNIT 18 05번') {
      console.error('대상 아님(안전중단):', p.id, doc.type, doc.source);
      continue;
    }
    const paragraph = `${p.given}\n###\n${MARKED_BODY}`;
    const markerCount = (paragraph.match(/[①②③④⑤]/g) ?? []).length;
    if (markerCount !== 5) {
      console.error('마커 수 오류 — 중단:', p.id, markerCount);
      continue;
    }
    const res = await col.updateOne(
      { _id },
      {
        $set: {
          'question_data.Paragraph': paragraph,
          'question_data.CorrectAnswer': p.answer,
          'question_data.Explanation': p.explanation,
          'question_data.GeneratedSentence': true,
          updated_at: new Date(),
        },
      },
    );
    console.log(`patched ${p.id} → answer ${p.answer}, markers ${markerCount}, modified ${res.modifiedCount}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
