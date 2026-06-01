/**
 * 요약 변형문제 12건 정리.
 *
 * 대상: 2027수능특강 영어(2026) 의 요약 문항 중, 요약문(빈칸 (A)/(B) 포함)이
 *       Question 필드 안에 들어 있어 본문 위에 표시되는 12건.
 *
 * 수정 내용:
 *   1) Question → 발문 한 줄만 (`다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?`)
 *   2) Paragraph 끝에 요약문 추가 (`{본문}\n\n{요약문}`)
 *   3) CorrectAnswer가 아라비아 숫자(1~5) 면 동그라미(①~⑤)로 정규화
 *
 * 사용:
 *   npx tsx scripts/fix-summary-question-above-passage.ts            # dry-run
 *   npx tsx scripts/fix-summary-question-above-passage.ts --apply    # 실제 갱신
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

const TARGET_IDS = [
  '69dfc35f45fcceb0f02f484d',
  '69dfc38945fcceb0f02f4852',
  '69dfc39345fcceb0f02f4853',
  '69dfc39d45fcceb0f02f4854',
  '69dfc4de45fcceb0f02f4855',
  '69dfc4f645fcceb0f02f4858',
  '69dfc50445fcceb0f02f485a',
  '69dfc52e45fcceb0f02f4860',
  '69dfc53245fcceb0f02f4861',
  '69dfc53e45fcceb0f02f4864',
  '69dfc54c45fcceb0f02f4866',
  '69dfc56145fcceb0f02f486a',
];

const STANDARD_QUESTION =
  '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?';

function normalizeCorrectAnswer(raw: string): string {
  const t = raw.trim();
  if (/^[①②③④⑤]$/.test(t)) return t;
  if (/^[1-5]$/.test(t)) return ['①', '②', '③', '④', '⑤'][parseInt(t, 10) - 1];
  // "1" + 군더더기 처리
  const m = t.match(/[①②③④⑤]/);
  if (m) return m[0];
  const m2 = t.match(/[1-5]/);
  if (m2) return ['①', '②', '③', '④', '⑤'][parseInt(m2[0], 10) - 1];
  return t;
}

/**
 * Question 문자열에서 요약문(빈칸 (A)/(B) 포함)만 추출.
 * 발문 줄·`↓` 마커·번호 표 행은 제거.
 */
function extractSummarySentence(question: string): string | null {
  const chunks = question
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tableRowRe = /^[①②③④⑤]/;
  const headerRowRe = /^\(A\)\s+\(B\)$|^\s*\(A\)\b.{0,5}\(B\)\s*$/;
  const arrowOnlyRe = /^[↓→]+$/;

  const summaryLines: string[] = [];

  for (const chunk of chunks) {
    if (chunk === STANDARD_QUESTION) continue;
    if (chunk.startsWith('다음 글의 내용을 한 문장으로 요약')) continue;
    if (arrowOnlyRe.test(chunk)) continue;
    // 청크 내부에서 표 행·헤더 줄을 제거
    const lines = chunk
      .split(/\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((l) => !tableRowRe.test(l))
      .filter((l) => !headerRowRe.test(l))
      .filter((l) => !arrowOnlyRe.test(l));
    if (lines.length > 0) {
      summaryLines.push(...lines);
    }
  }

  const joined = summaryLines.join(' ').trim();
  if (!joined) return null;
  if (!joined.includes('(A)') || !joined.includes('(B)')) return null;
  return joined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let ok = 0;
  let skipped = 0;
  let updated = 0;

  for (const idStr of TARGET_IDS) {
    const doc = await col.findOne({ _id: new ObjectId(idStr) });
    if (!doc) {
      console.log(`✗ ${idStr} : not found`);
      skipped += 1;
      continue;
    }
    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const question = String(qd.Question ?? '');
    const paragraph = String(qd.Paragraph ?? '');
    const correct = String(qd.CorrectAnswer ?? '');

    const summary = extractSummarySentence(question);
    if (!summary) {
      console.log(`✗ ${idStr} (${doc.source}) : 요약문 추출 실패`);
      console.log(`   Question 머리: ${question.slice(0, 120).replace(/\s+/g, ' ')}`);
      skipped += 1;
      continue;
    }

    const newQuestion = STANDARD_QUESTION;
    const newParagraph = `${paragraph.trim()}\n\n${summary}`;
    const newCorrect = normalizeCorrectAnswer(correct);

    const changes: string[] = [];
    if (newQuestion !== question) changes.push('Question');
    if (newParagraph !== paragraph) changes.push('Paragraph');
    if (newCorrect !== correct) changes.push(`CorrectAnswer("${correct}"→"${newCorrect}")`);

    console.log('─'.repeat(80));
    console.log(`${idStr} (${doc.source}) → 변경: ${changes.join(', ') || '없음'}`);
    console.log(`  요약문: ${summary}`);

    if (changes.length === 0) {
      skipped += 1;
      continue;
    }

    if (apply) {
      await col.updateOne(
        { _id: new ObjectId(idStr) },
        {
          $set: {
            'question_data.Question': newQuestion,
            'question_data.Paragraph': newParagraph,
            'question_data.CorrectAnswer': newCorrect,
            updated_at: new Date(),
          },
        },
      );
      updated += 1;
      console.log(`  ✓ updated`);
    } else {
      ok += 1;
    }
  }

  console.log('═'.repeat(80));
  if (apply) {
    console.log(`적용 완료: ${updated} updated, ${skipped} skipped`);
  } else {
    console.log(`DRY-RUN: ${ok} 적용 예정, ${skipped} skipped`);
    console.log('실제 적용: --apply 옵션 추가');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
