/**
 * 26년 3월 고3 영어모의고사 — 삽입-고난도 부족분만 채움 (API 없이 알고리즘 생성).
 *
 *   npx tsx scripts/fill-26mar-g3-hard-insertion.ts
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';
import { saveGeneratedQuestionToDb } from '../lib/variant-save-generated-question';
import { buildHardInsertionQuestionData, splitSentences } from '../lib/hard-insertion-generator';

const TEXTBOOK = '26년 3월 고3 영어모의고사';
const TYPE = '삽입-고난도' as const;

/** passage_id, source 라벨, 이번에 추가할 개수 */
const JOBS: { passageId: string; label: string; add: number }[] = [
  { passageId: '69c3e6b546f58f933b6dcd2d', label: '26년 3월 고3 영어모의고사 23번', add: 3 },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번', add: 2 },
  { passageId: '69c3e6b546f58f933b6dcd35', label: '26년 3월 고3 영어모의고사 31번', add: 2 },
  { passageId: '69c3e6b546f58f933b6dcd3c', label: '26년 3월 고3 영어모의고사 38번', add: 2 },
];

const passageCache = new Map<string, string>();

async function getPassageText(passageId: string, label: string): Promise<string> {
  if (passageCache.has(passageId)) return passageCache.get(passageId)!;

  const db = await getDb('gomijoshua');
  const cleanTypes = ['주제', '주장', '제목', '일치', '불일치', '빈칸'];
  for (const t of cleanTypes) {
    const q = await db.collection('generated_questions').findOne({
      textbook: TEXTBOOK,
      source: label,
      type: t,
    });
    const para = String((q?.question_data as Record<string, unknown>)?.Paragraph ?? '');
    if (para.length > 50 && !para.includes('<u>')) {
      passageCache.set(passageId, para);
      return para;
    }
  }
  const q2 = await db.collection('generated_questions').findOne({
    textbook: TEXTBOOK,
    source: label,
  });
  const para2 = String((q2?.question_data as Record<string, unknown>)?.Paragraph ?? '').replace(/<[^>]+>/g, '');
  passageCache.set(passageId, para2);
  return para2;
}

async function main() {
  const db = await getDb('gomijoshua');
  let ok = 0;
  let fail = 0;

  for (const job of JOBS) {
    const raw = await getPassageText(job.passageId, job.label);
    const paragraph = raw.replace(/\s+/g, ' ').trim();
    const sentences = splitSentences(paragraph);
    if (sentences.length < 5) {
      console.error(`SKIP (문장 부족 ${sentences.length}개): ${job.label}`);
      fail += job.add;
      continue;
    }

    const existing = await db.collection('generated_questions').countDocuments({
      textbook: TEXTBOOK,
      source: job.label,
      type: TYPE,
    });

    for (let i = 0; i < job.add; i++) {
      const version = existing + i;
      const qd = buildHardInsertionQuestionData(sentences, job.label, version);
      if (!qd) {
        console.error(`FAIL build: ${job.label} v${version}`);
        fail++;
        continue;
      }
      const num = version + 1;
      const question_data = {
        ...qd,
        순서: num,
        NumQuestion: num,
        Source: job.label,
        Category: '삽입',
        DifficultyLevel: '상',
      };

      const r = await saveGeneratedQuestionToDb({
        passage_id: job.passageId,
        textbook: TEXTBOOK,
        source: job.label,
        type: TYPE,
        question_data,
        status: '완료',
        option_type: 'English',
        difficulty: '상',
      });

      if (r.ok) {
        console.log(`OK ${job.label} 삽입-고난도 #${num} → ${r.inserted_id}`);
        ok++;
      } else {
        console.error(`SAVE-FAIL ${job.label} #${num}: ${'error' in r ? r.error : ''}`);
        fail++;
      }
    }
  }

  console.log(`\n완료: ${ok}건 저장, ${fail}건 실패/스킵`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
