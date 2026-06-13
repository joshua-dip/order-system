/**
 * MV-20260612-001 한글 선택지 영어화 배치2: 2024수능 33번 + 22년 9월 고2 38번 (12건, 2026-06-13).
 * 사용: npx tsx scripts/patch-mv-go2-eng-b2-20260613.ts [--apply]
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
  // ── 2024수능 33번 (faces / context)
  {
    id: '6a2bb2d3647637723fc4e3ef', type: '불일치', ca: '③', mustInclude: '대체될 수 없는 고유한 것',
    options: [
      'In psychological studies, subjects were shown photographs of faces and asked to identify the expression or state of mind.',
      'Charles Le Brun was a 17th-century French painter and theorist.',
      'The faces Le Brun drew were unique and could not be substituted for one another without loss.',
      'Some setting or context is needed to make an emotion determinate.',
      'In real life we come across people in particular situations, not just faces.',
    ],
  },
  {
    id: '6a2bb2d3647637723fc4e3f0', type: '불일치', ca: '④', mustInclude: '분리된 채 유지될 수 있다',
    options: [
      'The results of psychological studies asking subjects to identify facial expressions were invariably very mixed.',
      'The series of faces Le Brun drew showed the various emotions a painter could be called upon to represent.',
      'We need to know what is at stake in the scene, among other things.',
      'Our understanding of people can be held isolated from the social and human circumstances.',
      'In real life as well as in painting, we do not come across just faces.',
    ],
  },
  {
    id: '6a2bb2d5647637723fc4e3fb', type: '일치', ca: '①', mustInclude: '18세기에 활동한 영국',
    options: [
      'The results of the psychological studies on identifying facial expressions were invariably very mixed.',
      'Charles Le Brun was an 18th-century English painter and theorist.',
      'The faces Le Brun drew suffered a great loss of meaning when substituted for one another.',
      'What was present in all this was the context that makes an emotion determinate.',
      'In real life we come across just faces regardless of the situation.',
    ],
  },
  {
    id: '6a2bb2d5647637723fc4e3fc', type: '일치', ca: '①', mustInclude: '단일한 얼굴 그림',
    options: [
      'In the psychological studies, subjects were asked to identify the expression or state of mind from photographs of faces.',
      'Le Brun drew a single face showing only one emotion.',
      "What was striking about Le Brun's faces was that none of them could be substituted.",
      'The writer held that setting or context is unnecessary to make an emotion determinate.',
      'Our understanding of a person can be held isolated from social and human circumstances.',
    ],
  },
  {
    id: '6a2bb2d6647637723fc4e401', type: '주제', ca: '①', mustInclude: '감정을 확정적으로 이해하는 데 필수적인 상황과 맥락',
    options: [
      'the role of situation and context essential to understanding emotion definitely',
      'the development of expressive techniques painters showed in depicting facial expressions',
      'the methodological limits of designing psychological experiments using facial photographs',
      'the achievements of 17th-century painting theory in precisely classifying emotional expressions',
      "the importance of training to read minds accurately from others' expressions alone",
    ],
  },
  {
    id: '6a2bb2d6647637723fc4e402', type: '주제', ca: '②', mustInclude: '상황과 맥락이 감정 이해를 결정한다는 점',
    options: [
      'a painterly attempt to organize universal human emotions into standardized facial types',
      'the point that the situation and context surrounding an expression, rather than the expression itself, determine the understanding of emotion',
      'how photographic materials contribute to the objectivity of psychological experiments',
      'the observational skill a painter must have to reproduce various emotions on canvas',
      'the usefulness of a psychological approach that analyzes the inner self of an isolated individual',
    ],
  },
  // ── 22년 9월 고2 38번 (adaptation vs acclimation)
  {
    id: '6a2bb2ce647637723fc4e3a7', type: '불일치', ca: '③', mustInclude: '미래 세대에 물려진다',
    options: [
      'Adaptation involves changes in a population, with characteristics passed from one generation to the next.',
      "Acclimation is an individual organism's change in response to an altered environment.",
      'The skin pigments increased by acclimating to sunlight outdoors in summer are passed on to future generations.',
      'The capacity to produce skin pigments is inherited.',
      "A giraffe's long neck developed as individuals with longer necks gained an advantage in feeding on the leaves of tall trees.",
    ],
  },
  {
    id: '6a2bb2ce647637723fc4e3a8', type: '불일치', ca: '①', mustInclude: '적응과 달리 개체군의 변화가 아닌 개별',
    options: [
      'Adaptation, unlike acclimation, is a change in individual organisms only, not in a population.',
      'Acclimating to sunlight in summer, the skin increases its pigment concentration to protect itself from the sun.',
      'Dark skin pigments function to protect us from the sun.',
      'In intensely sunny environments, individuals good at producing pigments are more likely to thrive or survive.',
      'The trait of producing pigments well becomes increasingly common in later generations.',
    ],
  },
  {
    id: '6a2bb2cf647637723fc4e3b3', type: '일치', ca: '①', mustInclude: '다음 세대로 전해지는 특성을 동반',
    options: [
      'Adaptation involves characteristics passed from one generation to the next.',
      'Acclimation is a permanent change of an entire population in response to an altered environment.',
      'Skin changes that occur outdoors in summer are inherited by future generations.',
      'The capacity to produce skin pigments is acquired only after birth.',
      "A giraffe's long neck developed through random changes in short-necked individuals.",
    ],
  },
  {
    id: '6a2bb2cf647637723fc4e3b4', type: '일치', ca: '②', mustInclude: '태양으로부터 보호하는 기능',
    options: [
      'Adaptation and acclimation refer to essentially the same phenomenon.',
      'Dark pigments function to protect the skin from the sun.',
      'Individuals good at producing pigments are at a survival disadvantage in intensely sunny environments.',
      'Examples of adaptation are very rare in nature.',
      'The trait of producing pigments well becomes increasingly rare in later generations.',
    ],
  },
  {
    id: '6a2bb2cf647637723fc4e3b9', type: '주제', ca: '①', mustInclude: '유전되는 적응과 일시적인 순응의 차이',
    options: [
      'the difference between inherited adaptation and temporary acclimation',
      'the negative effect of environmental pollution on the evolution of organisms',
      "the advantage that an individual's learning ability gives to survival",
      'the biochemical principle by which skin pigments block ultraviolet rays',
      'the climatic factors that determine the diversity of animal body structures',
    ],
  },
  {
    id: '6a2bb2d0647637723fc4e3ba', type: '주제', ca: '③', mustInclude: '개체군 차원의 적응과 개체 차원의 순응 구분',
    options: [
      'the danger that sunlight exposure poses to skin health',
      "various ecological hypotheses about how the giraffe's neck lengthened",
      'the distinction between population-level adaptation and individual-level acclimation',
      'the lifestyle habits of an individual adapting to temporary environmental change',
      'the way inherited traits are transmitted through society and culture',
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
      report.push({ id: f.id, error: `사전 조건 불일치 (type=${doc?.type}, CA=${curCa})` });
      continue;
    }
    const newOptions = f.options.map((o, i) => `${CIRCLED[i]} ${o}`).join(' ### ');
    report.push({ id: f.id, type: f.type, action: APPLY ? '교체' : '교체 예정' });
    if (APPLY) await col.updateOne({ _id: doc._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, applied: report.filter((r) => r.action).length, skipped: report.filter((r) => 'error' in r) }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
