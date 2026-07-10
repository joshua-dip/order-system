/**
 * 선택형(2지선다) 문항에 대응하는 4지선다 객관식을 "새 문항"으로 추가 insert (기존 선택형 유지).
 * Pro 전용: 문항 내용은 채팅에서 작성한 JSON 을 받아 검증·insert 만 한다(ANTHROPIC API 미사용).
 *
 *   npx tsx scripts/import-mc-from-selection.ts --user-id <ObjectId> --json draft.json [--dry-run]
 *
 * draft.json 스키마: { items: [ {
 *   topicKey, section, no,            // 새 문항 위치(기존과 겹치지 않게. 보통 새 섹션/큰 no)
 *   instruction, question,           // question 은 ____ 빈칸 포함
 *   options: [4], answer: "①"~"④",  // 4지선다
 *   explanation, subjectiveAnswer,   // 주관식 원형 정답(빈칸에 들어갈 말)
 *   source?,                          // 없으면 원본 진도의 source 승계
 *   derivedFromSerial?                // 출처 선택형 G-...
 * } ] }
 * 과정/대단원/학습주제/unit/source 는 topicKey 로 기존 문항을 찾아 승계.
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, nextGrammarSerial, formatGrammarSerial } from '../lib/vip-grammar-problem-bank';

const CIRCLED = ['①', '②', '③', '④', '⑤'];

interface ItemIn {
  topicKey: string; section: string; no: number;
  instruction: string; question: string;
  options: string[]; answer: string;
  explanation?: string; subjectiveAnswer?: string;
  source?: string; derivedFromSerial?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const userIdArg = arg('--user-id');
  const jsonPath = arg('--json');
  if (!userIdArg || !jsonPath) { console.error('필수: --user-id <ObjectId> --json <file>'); process.exit(1); }
  const userId = new ObjectId(userIdArg);
  const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(raw) as { items: ItemIn[] };
  const items = parsed.items ?? [];

  // 검증
  const errs: string[] = [];
  items.forEach((it, i) => {
    if (!it.topicKey) errs.push(`#${i} topicKey 없음`);
    if (!it.question?.includes('____')) errs.push(`#${i} question 에 ____ 빈칸 없음`);
    if (!Array.isArray(it.options) || it.options.length !== 4) errs.push(`#${i} options 4개 아님`);
    if (!CIRCLED.slice(0, 4).includes((it.answer || '').trim())) errs.push(`#${i} answer 는 ①~④`);
    const ansIdx = CIRCLED.indexOf((it.answer || '').trim());
    if (ansIdx >= 0 && it.subjectiveAnswer && it.options[ansIdx] && !it.options[ansIdx].includes(it.subjectiveAnswer))
      errs.push(`#${i} 정답 보기(${it.options[ansIdx]})와 subjectiveAnswer(${it.subjectiveAnswer}) 불일치`);
  });
  if (errs.length) { console.error('검증 실패:\n' + errs.join('\n')); process.exit(1); }

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const now = new Date();
  let inserted = 0; let firstSerial = 0; let lastSerial = 0;
  const skipped: string[] = [];

  for (const it of items) {
    // topicKey 로 기존 문항에서 메타 승계
    const ref = await col.findOne({ userId, topicKey: it.topicKey }, { projection: { 과정: 1, 대단원: 1, 학습주제: 1, unit: 1, source: 1 } });
    if (!ref) { skipped.push(`${it.topicKey} — 기존 문항 없음(메타 승계 불가)`); continue; }
    const source = it.source ?? (ref.source as string);
    // 이미 이 선택형(derivedFromSerial)에서 파생한 객관식이 있으면 건너뜀(파일럿·재실행 중복 방지)
    if (it.derivedFromSerial) {
      const already = await col.findOne({ userId, derivedFromSerial: it.derivedFromSerial }, { projection: { _id: 1 } });
      if (already) { skipped.push(`${it.derivedFromSerial} — 이미 객관식 파생 존재`); continue; }
    }
    // 같은 (source,unit,section,no) 중복 방지
    const dup = await col.findOne({ userId, source, unit: ref.unit, section: it.section, no: it.no }, { projection: { _id: 1 } });
    if (dup) { skipped.push(`${it.topicKey} ${it.section}-${it.no} — 이미 존재`); continue; }
    // 보기 위치 셔플 — 에이전트의 정답 위치 쏠림 제거(정답 내용은 인덱스로 추적). Math.random 은 스크립트라 OK.
    const ansIdx0 = CIRCLED.indexOf(it.answer.trim());
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const options = order.map((k) => it.options[k]);
    const answer = CIRCLED[order.indexOf(ansIdx0)];
    const doc: Record<string, unknown> = {
      userId, source,
      topicKey: it.topicKey, 과정: ref.과정, 대단원: ref.대단원, 학습주제: ref.학습주제, unit: ref.unit,
      section: it.section, no: it.no,
      type: '객관식', category: '객관식',
      instruction: it.instruction,
      question: it.question, options, answer,
      explanation: it.explanation ?? '',
      subjective: it.subjectiveAnswer
        ? { type: '빈칸', instruction: '다음 빈칸에 알맞은 말을 쓰시오.', answer: it.subjectiveAnswer }
        : undefined,
      ...(it.derivedFromSerial ? { derivedFromSerial: it.derivedFromSerial } : {}),
    };
    if (dryRun) { inserted++; continue; }
    const serialNo = await nextGrammarSerial(db);
    if (!firstSerial) firstSerial = serialNo;
    lastSerial = serialNo;
    await col.insertOne({ ...doc, serialNo, createdAt: now, updatedAt: now });
    inserted++;
  }

  console.log(`\n${dryRun ? '[dry-run] ' : ''}객관식 신규 ${inserted}개${firstSerial ? ` (${formatGrammarSerial(firstSerial)}~${formatGrammarSerial(lastSerial)})` : ''}`);
  if (skipped.length) console.log(`건너뜀 ${skipped.length}:\n  ` + skipped.slice(0, 20).join('\n  '));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
