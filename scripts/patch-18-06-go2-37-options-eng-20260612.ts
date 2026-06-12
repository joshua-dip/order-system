/**
 * 18년 6월 고2 영어모의고사 37번 — 일치·불일치·주제 6건 Options 영어 재작성 (2026-06-12).
 *
 * 배경: MV-20260612-001 검수에서 발견. 오늘 생성된 37번 문항 중 일치·불일치·주제가
 * 한글 선택지로 저장됨 — 하우스 컨벤션(일치·불일치·주제 Options 는 영어, 26년 6월 고1
 * 기준 한글 비율 0~3%)과 메모리 규칙(불일치 영어 진술문만) 위반. 일치·불일치 4건은
 * 구분자(###·줄바꿈) 없이 한 줄이라 보기 1개로 파싱되는 형식 문제도 동반.
 *
 * 수정: 원문 대조로 각 한글 진술의 참/거짓 의미를 보존해 영어로 재작성,
 *       `① … ### ② …` 표준 형식으로 교체. 정답 슬롯·Explanation(한글 해설)은 유지.
 *       주장 2건은 한글 선택지가 허용 관행(실모 형식·기존 데이터 35%)이라 제외.
 *
 * 사용: npx tsx scripts/patch-18-06-go2-37-options-eng-20260612.ts [--apply]
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

/** id → { 기대 CA, 현재 한글 Options 식별용 부분 문자열, 새 영어 보기 5개 } */
const FIXES: { id: string; type: string; ca: string; mustInclude: string; options: string[] }[] = [
  {
    id: '6a2bb2c8647637723fc4e35f',
    type: '불일치',
    ca: '③',
    mustInclude: '상황적 설명은 단순하여 누구나 쉽게 떠올릴 수 있다',
    options: [
      'One reason people prioritize internal disposition is simplicity.',
      "Thinking of an internal cause for a person's behaviour is easy.",
      'Situational explanations are simple enough for anyone to come up with easily.',
      "Parents who boast of their children's achievements may be anxious about their failures.",
      'Situational factors require knowledge, insight, and time to think through.',
    ],
  },
  {
    id: '6a2bb2c8647637723fc4e360',
    type: '불일치',
    ca: '⑤',
    mustInclude: '상황적 요소들은 지식 없이 즉각적으로 파악할 수 있다',
    options: [
      'People like to prioritize internal disposition over external situations when seeking causes of behaviour.',
      'A teacher who appears stubborn may want her students to develop self-discipline.',
      'Jumping to a dispositional attribution is far easier than thinking through situational explanations.',
      "Parents who boast of their children's achievements may be conscious of the cost of their school fees.",
      'Situational factors can be grasped immediately without any knowledge.',
    ],
  },
  {
    id: '6a2bb2c9647637723fc4e36b',
    type: '일치',
    ca: '①',
    mustInclude: '한 사람의 행동에 대한 내적 원인을 생각해내는 것은 어렵다',
    options: [
      'One reason people prioritize internal disposition is simplicity.',
      "Thinking of an internal cause for a person's behaviour is difficult.",
      'Situational explanations are generally simple.',
      "Parents who boast of their children's achievements are indifferent to their failures.",
      'Jumping to a dispositional attribution is far more difficult than giving a situational explanation.',
    ],
  },
  {
    id: '6a2bb2c9647637723fc4e36c',
    type: '일치',
    ca: '②',
    mustInclude: '엄격해 보이는 선생님은 학생들의 자기 단련 능력을 길러주고자 할 수 있다',
    options: [
      'Jumping to a dispositional attribution requires a great deal of time and insight.',
      'A teacher who seems strict may want to develop self-discipline in her students.',
      'People like to prioritize external situations over internal disposition.',
      'Understanding situational factors requires no knowledge at all.',
      'The devoted parents simply hate their children.',
    ],
  },
  {
    id: '6a2bb2c9647637723fc4e371',
    type: '주제',
    ca: '①',
    mustInclude: '사람들이 행동의 원인으로 상황보다 기질을 선호하는 이유',
    options: [
      'why people prefer disposition to situations in explaining behaviour',
      "various cues for accurately predicting others' behaviour",
      "positive effects of parental devotion on children's education",
      "effects of strict teaching styles on students' self-discipline",
      'misunderstandings in communication caused by considering situational factors',
    ],
  },
  {
    id: '6a2bb2c9647637723fc4e372',
    type: '주제',
    ca: '②',
    mustInclude: '행동의 원인을 기질에서 찾는 경향',
    options: [
      'limitations of complex situational explanations in understanding behaviour',
      'simplicity as the reason for the tendency to attribute behaviour to disposition',
      'how teachers and parents develop self-discipline in students',
      'the development of various psychological theories explaining human behaviour',
      'insight needed to evaluate others fairly',
    ],
  },
];

const CIRCLED = ['①', '②', '③', '④', '⑤'];

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
    report.push({
      id: f.id,
      type: f.type,
      ca: f.ca,
      action: APPLY ? '교체' : '교체 예정',
      newOptionsPreview: newOptions.slice(0, 110),
    });
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
