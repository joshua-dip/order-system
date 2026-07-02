/**
 * VIP '내 문제'(vip_saved_questions) 로 모의고사 변형문제를 폴더 분류해 담기.
 * 앱의 POST /api/my/vip/question-bank 저장 로직(upsert · $setOnInsert · status='완료' 스냅샷)을 그대로 재사용.
 *
 *   npx tsx scripts/vip-import-mock-to-bank.ts            # dry-run (계획만 출력)
 *   npx tsx scripts/vip-import-mock-to-bank.ts --apply    # 실제 담기
 *
 * 대상: 26년 3월·6월 × 고1·고2·고3 모의고사 (교재명 자동 발견). 폴더 = "26년 N월 고M".
 * 계정: VIP 조슈아(loginId 01079270806).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { QUESTION_BANK_COLLECTION, ensureQuestionBankIndexes, previewText, type SavedQuestionDoc } from '@/lib/vip-question-bank-store';

loadCliEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const APPLY = process.argv.includes('--apply');
const LOGIN_ID = '01079270806'; // VIP 조슈아

/** 교재명에서 (월, 학년) 추출 → 대상 여부 + 폴더명. */
function classify(textbook: string): { folder: string; month: string; grade: string } | null {
  const yearOk = /26년|2026/.test(textbook);
  const m = textbook.match(/(3월|6월)/);
  const g = textbook.match(/고\s*([123])/);
  if (!yearOk || !m || !g) return null;
  const month = m[1];
  const grade = `고${g[1]}`;
  return { folder: `26년 ${month} ${grade}`, month, grade };
}

async function main() {
  const db = await getDb('gomijoshua');
  await ensureQuestionBankIndexes(db);

  const user = await db.collection('users').findOne({ loginId: LOGIN_ID }, { projection: { _id: 1, name: 1 } });
  if (!user) throw new Error(`조슈아 계정(loginId ${LOGIN_ID})을 찾을 수 없습니다.`);
  const userId = user._id as ObjectId;
  console.log(`대상 계정: ${user.name ?? ''} (${LOGIN_ID})  userId=${userId.toString()}`);
  console.log(`모드: ${APPLY ? '★ APPLY (실제 담기)' : 'dry-run (계획만)'}\n`);

  const gen = db.collection('generated_questions');
  const bank = db.collection(QUESTION_BANK_COLLECTION);

  // 1) 대상 교재 발견 — 완료 문항이 있는 교재 중 26년 3·6월 고1/2/3.
  const allTextbooks: string[] = (await gen.distinct('textbook', { status: '완료' })) as string[];
  const targets = allTextbooks
    .map((t) => ({ textbook: t, ...(classify(t) ?? {}) }))
    .filter((x): x is { textbook: string; folder: string; month: string; grade: string } => !!(x as { folder?: string }).folder)
    .sort((a, b) => a.folder.localeCompare(b.folder, 'ko'));

  if (targets.length === 0) {
    console.log('⚠️  26년 3·6월 고1/2/3 모의고사 교재를 찾지 못했습니다. (교재명 확인 필요)');
    console.log('   status=완료 인 교재 중 "26년"+"3월/6월"+"고1/2/3" 을 모두 포함하는 교재가 없음.');
    process.exit(0);
  }

  const proj = { serialNo: 1, type: 1, textbook: 1, source: 1, difficulty: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Source': 1 } as const;
  let grandAdded = 0, grandCompleted = 0, grandAlready = 0;

  for (const { textbook, folder } of targets) {
    const filter = { textbook, status: '완료' };
    const completed = await gen.countDocuments(filter);
    const already = await bank.countDocuments({ userId, textbook });
    grandCompleted += completed;

    if (!APPLY) {
      console.log(`📁 ${folder}\n    교재: ${textbook}\n    완료 문항: ${completed}개 · 이미 담긴: ${already}개 → 담을(신규): 최대 ${completed}개`);
      continue;
    }

    // 실제 담기 — 완료 문항 전부 upsert($setOnInsert), 1000개씩 배치.
    const docs = await gen.find(filter).project(proj).toArray();
    const now = new Date();
    let added = 0;
    for (let i = 0; i < docs.length; i += 1000) {
      const chunk = docs.slice(i, i + 1000);
      const ops = chunk.map((d) => {
        const qd = (d.question_data ?? {}) as { Question?: string; Paragraph?: string; Source?: string };
        const set: SavedQuestionDoc = {
          userId,
          questionId: d._id as ObjectId,
          serialNo: typeof d.serialNo === 'number' ? d.serialNo : undefined,
          type: String(d.type ?? ''),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? qd.Source ?? ''),
          difficulty: String(d.difficulty ?? ''),
          question: previewText(qd.Question, 90),
          preview: previewText(qd.Paragraph, 140),
          folder,
          tags: [],
          savedAt: now,
        };
        return { updateOne: { filter: { userId, questionId: d._id }, update: { $setOnInsert: set }, upsert: true } };
      });
      const r = await bank.bulkWrite(ops, { ordered: false });
      added += r.upsertedCount;
    }
    grandAdded += added;
    grandAlready += (docs.length - added);
    // 폴더 정규화 — 이 교재의 담긴 문항이 다른 폴더/미분류에 있으면 해당 모의고사 폴더로 이동.
    const norm = await bank.updateMany({ userId, textbook, folder: { $ne: folder } }, { $set: { folder } });
    console.log(`📁 ${folder}  ← ${textbook}\n    완료 ${completed} · 신규 담김 ${added} · 이미있음 ${docs.length - added}${norm.modifiedCount ? ` · 폴더이동 ${norm.modifiedCount}` : ''}`);
  }

  console.log('\n──────────────');
  if (APPLY) console.log(`✅ 완료: 폴더 ${targets.length}개 · 신규 담김 ${grandAdded}개 (이미있음 ${grandAlready}개, 완료문항 합계 ${grandCompleted}개)`);
  else console.log(`계획: 폴더 ${targets.length}개 · 완료문항 합계 ${grandCompleted}개. 실제 담으려면 --apply 로 재실행.`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
