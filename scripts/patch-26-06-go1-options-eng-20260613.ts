/**
 * 26년 6월 고1 영어모의고사 29번·39번 — 일치·불일치 12건 Options 영어 재작성 (2026-06-13).
 *
 * 정합 검증(hangul_options_in_english_type)에서 검출된 한글 선택지 문항.
 * 원문 대조로 각 한글 진술의 참/거짓 의미를 보존해 영어 진술문으로 교체.
 * 정답 슬롯·한글 해설(내용 설명이라 유효)은 유지.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-options-eng-20260613.ts [--apply]
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
  // ── 29번 (Literature)
  {
    id: '6a27e2d28e8d640175b8a917',
    type: '불일치',
    ca: '④',
    mustInclude: '새로운 기술의 등장으로 그 의미를 완전히 상실했다',
    options: [
      'Literature helps us gain a deeper understanding of the human condition.',
      'Literature has retained its relevance as a timeless art form.',
      'Literature connects us with the thoughts and emotions of people from all walks of life.',
      'Literature has completely lost its significance with the rise of new technologies.',
      'Authors have the ability to explore the depths of human emotion through the written word.',
    ],
  },
  {
    id: '6a27e2d28e8d640175b8a918',
    type: '불일치',
    ca: '③',
    mustInclude: '오직 현대의 디지털 매체를 통해서만',
    options: [
      'Literature connects people across centuries and cultures.',
      'Literature allows us to empathize with characters different from ourselves.',
      'Literature is delivered only through modern digital media.',
      'Literature is a testament to the enduring power of human creativity and expression.',
      'Literature can capture and convey the complexities of the human experience.',
    ],
  },
  {
    id: '6a27e2d28e8d640175b8a919',
    type: '불일치',
    ca: '③',
    mustInclude: '인간 감정보다 기술 발전을 다루는 데 집중한다',
    options: [
      'Authors have the ability to explore the challenges and triumphs of the human spirit.',
      'Literature has the quality of transcending time and space.',
      'Literature focuses on dealing with technological advances rather than human emotions.',
      'Literature provides a deeper understanding of the human condition.',
      'Literature allows us to see ourselves reflected in the pages of a book.',
    ],
  },
  {
    id: '6a27e2d28e8d640175b8a914',
    type: '일치',
    ca: '④',
    mustInclude: '글쓰기의 목적은 인간 경험의 복잡성을 단순화하는 데 있다',
    options: [
      'The purpose of writing is to simplify the complexities of the human experience.',
      'Authors are described as lacking the ability to deal with human emotions.',
      'Literature has lost most of its significance with the rise of new technologies.',
      "Literature transcends time and space, connecting us with people's thoughts and emotions.",
      'Literature is described as an art form mainly for the wealthy.',
    ],
  },
  {
    id: '6a27e2d28e8d640175b8a915',
    type: '일치',
    ca: '④',
    mustInclude: '작가들은 글보다 영상으로 감정을 표현하는 것을 선호한다',
    options: [
      'Authors prefer to express emotions through video rather than the written word.',
      'Literature is shared only among people from the same culture.',
      'The value of literature has steadily declined over time.',
      'Literature has the ability to capture and convey the complexities of the human experience.',
      'Literature is rapidly disappearing with the rise of new media.',
    ],
  },
  {
    id: '6a27e2d28e8d640175b8a916',
    type: '일치',
    ca: '①',
    mustInclude: '문학은 우리가 자신과 다른 인물들에게 공감하도록 돕는다',
    options: [
      'Literature helps us empathize with characters different from ourselves.',
      'Literature has completely lost its relevance because of new technologies.',
      'Authors are unable to explore the nuances of relationships.',
      'Literature has only recently begun to be recognized as an art form.',
      'Literature is described as hindering our understanding of the human condition.',
    ],
  },
  // ── 39번 (Deforestation)
  {
    id: '6a27ff2597b3a4799b37b695',
    type: '불일치',
    ca: '②',
    mustInclude: '나무가 많아지면 대기 중 이산화탄소가 오히려 증가한다',
    options: [
      "Deforestation prevents trees' CO2 conversion process from being fully accomplished.",
      'A larger amount of trees leads to increased carbon dioxide in the atmosphere.',
      'Deforestation is mentioned as a major issue when it comes to global warming.',
      'Trees are viewed as a natural regulator of carbon dioxide.',
      "With half of the Earth's forests gone, the amount of carbon dioxide is rising.",
    ],
  },
  {
    id: '6a27ff2597b3a4799b37b696',
    type: '불일치',
    ca: '③',
    mustInclude: '태양 복사는 이산화탄소 증가와 무관하게 우주로 방출된다',
    options: [
      'Carbon dioxide in the atmosphere is progressively rising due to deforestation.',
      'Trees play a huge role in the carbon cycle.',
      "The sun's radiation is released into space regardless of the increase in carbon dioxide.",
      'Approximately 15-20% of greenhouse gas emissions are caused by degradation and deforestation.',
      'Trees convert CO2 to oxygen through photosynthesis.',
    ],
  },
  {
    id: '6a27ff2597b3a4799b37b697',
    type: '불일치',
    ca: '⑤',
    mustInclude: '광합성은 산소를 이산화탄소로 바꾸어',
    options: [
      'Trees convert the CO2 in the air to oxygen through the process of photosynthesis.',
      "Deforestation weakens trees' function of regulating carbon dioxide.",
      'A larger amount of trees leads to reduced carbon dioxide in the atmosphere.',
      "The increase in carbon dioxide causes the planet's average temperature to rise.",
      'Photosynthesis turns oxygen into carbon dioxide and releases it into the atmosphere.',
    ],
  },
  {
    id: '6a27ff2597b3a4799b37b692',
    type: '일치',
    ca: '⑤',
    mustInclude: '삼림 벌채는 대기 중 이산화탄소 농도를 점차 감소시킨다',
    options: [
      'Deforestation gradually reduces the level of carbon dioxide in the atmosphere.',
      'Trees purify the air by converting oxygen into carbon dioxide.',
      "It is estimated that 90% of the world's forests have already disappeared.",
      'Most greenhouse gas emissions come from ocean pollution.',
      'Trees convert CO2 to oxygen through the process of photosynthesis.',
    ],
  },
  {
    id: '6a27ff2597b3a4799b37b693',
    type: '일치',
    ca: '④',
    mustInclude: '삼림 벌채는 나무의 광합성 과정을 더욱 촉진한다',
    options: [
      'Deforestation further promotes the photosynthesis of trees.',
      "All of the sun's radiation is released into space without affecting the Earth.",
      'An increase in trees leads to a rise in atmospheric carbon dioxide.',
      'Approximately 15-20% of global greenhouse gas emissions are caused by degradation and deforestation.',
      "The Earth's average temperature stays constant regardless of carbon dioxide levels.",
    ],
  },
  {
    id: '6a27ff2597b3a4799b37b694',
    type: '일치',
    ca: '③',
    mustInclude: '이산화탄소가 늘면 더 많은 태양 복사가 지구로 반사된다',
    options: [
      "Although half of the Earth's forests are gone, carbon dioxide is decreasing.",
      'Trees play little role in the carbon cycle.',
      "With more carbon dioxide, more of the sun's radiation is reflected back to Earth.",
      'Deforestation is an issue unrelated to global warming.',
      'A decrease in the number of trees increases the amount of oxygen in the atmosphere.',
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
