/**
 * 어휘 변형의 Options 가 배열로 저장된 문항을 표준 문자열 형식으로 교정.
 *
 *   ["trigger","decrease",…]  →  "① trigger ### ② decrease ### …"
 *
 * 배열은 `String(qd.Options)` 를 거치며 "trigger,decrease,…" 한 덩어리가 되어
 * 시험지 렌더러(final-exam-html renderOptions)에서 보기 한 줄로 뭉친다.
 * 순서를 그대로 유지하므로 CorrectAnswer 는 손대지 않는다.
 *
 * 안전장치: 배열 원소가 5개이고, 각 원소가 Paragraph 의 ①~⑤ 마커 바로 뒤 표현과
 * 일치할 때만 교정한다(마커와 보기의 대응이 깨진 문항은 건너뛰고 보고).
 *
 *   npx tsx scripts/patch-vocab-array-options.ts --textbook "교재명" [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const textbook = argOf('--textbook');
  const apply = process.argv.includes('--apply');
  if (!textbook) {
    console.log('사용: npx tsx scripts/patch-vocab-array-options.ts --textbook "교재명" [--apply]');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const rows = await col.find({ textbook, type: { $in: ['어휘', '어휘-고난도'] } }).toArray();
  const targets = rows.filter((r) => Array.isArray((r as Record<string, unknown> & { question_data?: { Options?: unknown } }).question_data?.Options));

  console.log(`${textbook} — 어휘 ${rows.length}건 중 배열 저장 ${targets.length}건`);

  let fixed = 0;
  const skipped: string[] = [];

  for (const row of targets) {
    const doc = row as unknown as {
      _id: unknown;
      source: string;
      serialNo?: number;
      question_data: { Options: string[]; Paragraph?: string };
    };
    const opts = doc.question_data.Options.map((o) => String(o).trim());
    const para = String(doc.question_data.Paragraph ?? '');
    const tag = `${doc.source} [${doc.serialNo ?? '-'}]`;

    if (opts.length !== 5) { skipped.push(`${tag} 보기 ${opts.length}개`); continue; }

    // 본문 마커 바로 뒤 표현이 보기와 같은지 (①trigger / ① trigger / ①<u>trigger</u> 모두 허용)
    const mismatch: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const m = para.match(new RegExp(`${CIRCLED[i]}\\s*(?:<u>)?\\s*([^\\s<,.;:)]+(?:\\s+[^\\s<,.;:)]+)?)`));
      const seen = (m?.[1] ?? '').trim();
      if (!seen || !seen.startsWith(opts[i].split(/\s+/)[0])) {
        mismatch.push(`${CIRCLED[i]} 본문="${seen}" ≠ 보기="${opts[i]}"`);
      }
    }
    if (mismatch.length) { skipped.push(`${tag} ${mismatch.join(' / ')}`); continue; }

    const next = opts.map((o, i) => `${CIRCLED[i]} ${o}`).join(' ### ');
    if (apply) {
      await col.updateOne(
        { _id: doc._id as never },
        { $set: { 'question_data.Options': next, updated_at: new Date() }, $push: { optionsFormatBackup: { at: new Date(), before: opts } } as never },
      );
    }
    fixed += 1;
    if (fixed <= 3) console.log(`  ${apply ? '수정' : '예정'} ${tag}  →  ${next}`);
  }

  console.log(`\n${apply ? '수정 완료' : '수정 예정'} ${fixed}건 / 건너뜀 ${skipped.length}건`);
  for (const s of skipped) console.log(`  건너뜀 ${s}`);
  if (!apply) console.log('\n실제 반영: --apply 추가');
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
