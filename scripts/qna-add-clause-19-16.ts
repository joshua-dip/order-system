/**
 * 26년 5월 고3 영어모의고사 19번 (passageId 69fe3e8d36e33281b7111f79) 의
 * sentence 16 「Paul's heart raced, and his hands grew sweaty.」 에 두 번째 절 SVOC 추가.
 *
 * 현재 svocData[16] = [{ subject: "Paul's heart", verb: "raced" }]
 * 추가될 절       = { subject: "his hands", verb: "grew", subjectComplement: "sweaty" }
 *
 * 사용: MONGODB_URI="..." npx tsx scripts/qna-add-clause-19-16.ts [--apply]
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  passageAnalysisFileNameForPassageId,
  type SvocSentenceData,
} from '@/lib/passage-analyzer-types';
import { findWordIndices } from '@/lib/syntax-analyzer-word-match';

const PASSAGE_ID = '69fe3e8d36e33281b7111f79';
const TARGET_SENTENCE_IDX = 16;

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');

  // 1) 현재 sentence + svocData[16] 확인
  const analysis = await db.collection('passage_analyses').findOne(
    { fileName: passageAnalysisFileNameForPassageId(PASSAGE_ID) },
    {
      projection: {
        _id: 1,
        'passageStates.main.sentences': 1,
        'passageStates.main.svocData': 1,
      },
    }
  );
  if (!analysis) {
    console.error('passage_analyses 없음');
    process.exit(1);
  }
  const main = (analysis as { _id: ObjectId; passageStates?: { main?: { sentences?: string[]; svocData?: Record<string, SvocSentenceData | SvocSentenceData[]> } } })
    .passageStates?.main;
  const docId = (analysis as { _id: ObjectId })._id;

  const sentence = main?.sentences?.[TARGET_SENTENCE_IDX] ?? '';
  console.log('대상 sentence:', sentence);

  const raw = main?.svocData?.[String(TARGET_SENTENCE_IDX)];
  const existing: SvocSentenceData[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  console.log('기존 절 수:', existing.length);
  existing.forEach((c, i) => {
    console.log(`  [${i}] S="${c.subject}" V="${c.verb}" C="${c.subjectComplement ?? c.complement ?? ''}"`);
  });

  // 2) 두 번째 절 구성: "his hands grew sweaty"
  const SUBJECT = 'his hands';
  const VERB = 'grew';
  const COMPLEMENT = 'sweaty';
  const sIdx = findWordIndices(sentence, SUBJECT);
  const vIdx = findWordIndices(sentence, VERB);
  const cIdx = findWordIndices(sentence, COMPLEMENT);
  console.log('\n매칭 결과:');
  console.log(`  S "${SUBJECT}" → ${sIdx.startWordIndex}~${sIdx.endWordIndex}`);
  console.log(`  V "${VERB}"    → ${vIdx.startWordIndex}~${vIdx.endWordIndex}`);
  console.log(`  Cs "${COMPLEMENT}" → ${cIdx.startWordIndex}~${cIdx.endWordIndex}`);

  if (sIdx.startWordIndex < 0 || vIdx.startWordIndex < 0) {
    console.error('S/V word index 찾기 실패 — sentence 확인 필요');
    process.exit(1);
  }

  const newClause: SvocSentenceData = {
    subject: SUBJECT,
    verb: VERB,
    object: null,
    complement: null,
    subjectStart: sIdx.startWordIndex,
    subjectEnd: sIdx.endWordIndex,
    verbStart: vIdx.startWordIndex,
    verbEnd: vIdx.endWordIndex,
    objectStart: null,
    objectEnd: null,
    complementStart: null,
    complementEnd: null,
    subjectComplement: COMPLEMENT,
    subjectComplementStart: cIdx.startWordIndex >= 0 ? cIdx.startWordIndex : null,
    subjectComplementEnd: cIdx.endWordIndex >= 0 ? cIdx.endWordIndex : null,
  };

  // 이미 같은 절이 추가돼 있다면 skip (idempotent)
  const dup = existing.some(
    (c) => c.subject?.trim() === SUBJECT && c.verb?.trim() === VERB
  );
  if (dup) {
    console.log('\n[ok] 이미 같은 절이 있음 — skip.');
    process.exit(0);
  }

  const next = [...existing, newClause];
  console.log('\n새 절 추가 후 총', next.length, '개');

  if (!apply) {
    console.log('\n[dry-run] 변경 안 함. --apply 옵션으로 실제 적용.');
    process.exit(0);
  }

  await db.collection('passage_analyses').updateOne(
    { _id: docId },
    {
      $set: {
        [`passageStates.main.svocData.${TARGET_SENTENCE_IDX}`]: next,
        updated_at: new Date(),
      },
    }
  );
  console.log('\n[apply] 업데이트 완료.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
