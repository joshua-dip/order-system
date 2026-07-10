/**
 * 문법 문제은행 임포트 — 창작 문항 JSON 을 vip_grammar_problems 에 넣고 고유번호(G-)를 부여한다.
 *
 * 사용:
 *   npx tsx scripts/import-grammar-problems.ts --user-id <ObjectId> --course "중등 영문법 LEVEL 1" \
 *     --source "자체 제작 LEVEL 1" [--dry-run] file1.json file2.json ...
 *
 * JSON 스키마 (파일당):
 *   { "units": [ { "unit": 1, "chapter": "be동사와 인칭대명사", "topic": "be동사의 현재형과 과거형",
 *       "sections": [ { "label": "A", "type": "선택형", "instruction": "...", "choices": ["..."]?,
 *         "items": [ { "no": 1, "question": "...", "answer": "...", "explanation": "..." } ] } ] } ] }
 *
 * - 멱등: (userId, source, unit, section, no) 로 upsert — 재실행해도 중복 삽입 없음.
 *   신규 문서에만 serialNo 발급(기존 문서 serial 유지).
 * - topicKey = grammarTopicKey(과정, chapter, topic) — 문법 문제관리 트리와 정확히 일치해야 한다.
 */
import { loadCliEnv } from './_cli-env';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';

loadCliEnv(path.resolve(__dirname, '..'));
import { getDb } from '../lib/mongodb';
import { GRAMMAR_CURRICULA, grammarTopicKey } from '../lib/grammar-curriculum';
import { GRAMMAR_PROBLEMS_COLLECTION, nextGrammarSerial, formatGrammarSerial } from '../lib/vip-grammar-problem-bank';
import { deriveProblemCategory } from '../lib/vip-problem-category';

interface ItemIn { no: number; question: string; answer: string; explanation?: string; choices?: string[]; options?: string[] }
interface SectionIn { label: string; type: string; instruction: string; choices?: string[]; items: ItemIn[] }

const CIRCLED = ['①', '②', '③', '④', '⑤'];
interface UnitIn { unit: number; chapter: string; topic: string; sections: SectionIn[] }

function fail(msg: string): never {
  console.error('❌', msg);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dryRun = args.includes('--dry-run');
  const userIdRaw = opt('user-id') ?? '';
  const course = opt('course') ?? '중등 영문법 LEVEL 1';
  const source = opt('source') ?? '자체 제작';
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1]?.replace(/^--/, '') !== 'user-id' && args[i - 1] !== '--course' && args[i - 1] !== '--source');
  if (!ObjectId.isValid(userIdRaw)) fail(`--user-id 가 유효한 ObjectId 가 아님: "${userIdRaw}"`);
  if (files.length === 0) fail('임포트할 JSON 파일 경로가 없습니다.');

  // 커리큘럼 대조 준비 — topic/chapter 문자열이 트리와 정확히 일치해야 클릭 연동이 된다.
  const cur = GRAMMAR_CURRICULA.find((c) => c.과정 === course);
  if (!cur) fail(`과정 "${course}" 이 GRAMMAR_CURRICULA 에 없음`);
  const validTopics = new Map<string, string>(); // topic → chapter
  for (const big of cur.대단원) for (const t of big.학습주제 ?? []) validTopics.set(t, big.대단원명);

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const userId = new ObjectId(userIdRaw);
  const now = new Date();

  let inserted = 0, updated = 0, skipped = 0, firstSerial = 0, lastSerial = 0;
  const problems: Array<{ unit: number; chapter: string; topic: string; sec: SectionIn; it: ItemIn }> = [];

  for (const f of files) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) fail(`파일 없음: ${p}`);
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as { units: UnitIn[] };
    if (!Array.isArray(data.units)) fail(`${f}: units 배열 없음`);
    for (const u of data.units) {
      const chapterInTree = validTopics.get(u.topic);
      if (!chapterInTree) fail(`${f}: 트리에 없는 topic "${u.topic}" (unit ${u.unit}) — 커리큘럼과 문자열이 다름`);
      if (chapterInTree !== u.chapter) fail(`${f}: unit ${u.unit} chapter 불일치 — JSON "${u.chapter}" vs 트리 "${chapterInTree}"`);
      for (const sec of u.sections) {
        for (const it of sec.items) {
          if (!it.question?.trim() || !it.answer?.trim()) fail(`${f}: unit ${u.unit} ${sec.label}-${it.no} question/answer 비었음`);
          // 객관식(options) 검증: 4지선다, 중복 없음, 정답은 ①~④ 중 하나
          if (it.options) {
            if (!Array.isArray(it.options) || it.options.length !== 4) fail(`${f}: u${u.unit} ${sec.label}-${it.no} options 4개 아님`);
            if (new Set(it.options.map((o) => o.trim())).size !== 4) fail(`${f}: u${u.unit} ${sec.label}-${it.no} options 중복`);
            if (!CIRCLED.slice(0, 4).includes(it.answer.trim())) fail(`${f}: u${u.unit} ${sec.label}-${it.no} answer 가 ①~④ 아님: "${it.answer}"`);
          }
          problems.push({ unit: u.unit, chapter: u.chapter, topic: u.topic, sec, it });
        }
      }
    }
  }

  // 유닛 → 섹션 → 번호 순으로 고유번호가 이어지게 정렬
  problems.sort((a, b) => a.unit - b.unit || a.sec.label.localeCompare(b.sec.label) || a.it.no - b.it.no);
  console.log(`검증 통과: 문항 ${problems.length}개 (${files.length}개 파일)`);
  if (dryRun) { console.log('dry-run — DB 미변경'); process.exit(0); }

  for (const pr of problems) {
    const key = { userId, source, unit: pr.unit, section: pr.sec.label, no: pr.it.no };
    const topicKey = grammarTopicKey(course, pr.chapter, pr.topic);
    const choices = pr.it.choices?.length ? pr.it.choices : pr.sec.choices;
    const base: Record<string, unknown> = {
      topicKey, 과정: course, 대단원: pr.chapter, 학습주제: pr.topic,
      type: pr.sec.type, instruction: pr.sec.instruction,
      question: pr.it.question, answer: pr.it.answer, explanation: pr.it.explanation ?? '',
      updatedAt: now,
    };
    // 객관식이면 options 저장 + 보기(choices) 제거, 아니면 choices 유지
    const unset: Record<string, ''> = {};
    if (pr.it.options?.length) {
      base.options = pr.it.options;
      unset.choices = '';
    } else if (choices?.length) {
      base.choices = choices;
    }
    base.category = deriveProblemCategory({ type: pr.sec.type, options: base.options, answer: pr.it.answer });
    const existing = await col.findOne(key, { projection: { _id: 1 } });
    if (existing) {
      await col.updateOne(key, Object.keys(unset).length ? { $set: base, $unset: unset } : { $set: base });
      updated++;
    } else {
      const serialNo = await nextGrammarSerial(db);
      if (!firstSerial) firstSerial = serialNo;
      lastSerial = serialNo;
      await col.insertOne({ ...key, ...base, serialNo, createdAt: now });
      inserted++;
    }
  }

  console.log(`완료: 신규 ${inserted} (${formatGrammarSerial(firstSerial)}~${formatGrammarSerial(lastSerial)}), 갱신 ${updated}, 건너뜀 ${skipped}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
