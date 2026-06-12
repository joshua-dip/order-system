/**
 * 26년 6월 고1 영어모의고사 — 검증에서 확인된 데이터 수정 4종 (2026-06-12).
 *
 *   1. 순서 24번 6a21b32b…: CorrectAnswer ④ → ① (해설은 이미 (A)-(C)-(B) 기준으로 정상)
 *   2. 어법 34번 6a21b44f…: Paragraph ④ <u>do</u> → <u>does</u>
 *      (해설이 "wrongForm으로 does를 넣었다"고 기술하는데 본문이 원문 그대로라 틀린 보기가 없던 문항)
 *   3. 요약 25·27·28·40번 4건: Question 끝의 「→ 요약문」을 Paragraph 하단으로 이동
 *      (표준 구조: 본문 → 빈 줄 → 요약문 — → 접두사는 표준에 없으므로 제거)
 *   4. 순서 비표준 보기 배열(고정 5세트 위반) 전건: Options 를 고정 세트로 교체하고
 *      CorrectAnswer 를 기존 정답 순열의 새 위치로 재매핑. 해설이 동그라미 번호를
 *      참조하면 같이 치환. 정답 순열이 고정 세트에 없으면 건너뛰고 보고.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-validation-fixes-20260612.ts [--apply]
 *       (기본 dry-run — 변경 내용만 출력)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  ORDER_CIRCLED,
  ORDER_FIXED_OPTIONS,
  isStandardOrderOptions,
  normalizeOrderOption,
  parseOrderOptions,
} from '@/lib/order-variant-validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const TEXTBOOK = '26년 6월 고1 영어모의고사';
const APPLY = process.argv.includes('--apply');

const ORDER_ANSWER_FIX_ID = '6a21b32bd934b8ce59768b2c'; // 순서 24번 ④→①
const GRAMMAR_FIX_ID = '6a21b44fd934b8ce59768c81'; // 어법 34번 do→does
const SUMMARY_FIX_IDS = [
  '6a249b51d0c597982468bcc7', // 25번
  '6a249c3dd0c597982468bcdf', // 27번
  '6a249caad0c597982468bceb', // 28번
  '6a24a270d0c597982468bd7b', // 40번
];

const STANDARD_OPTIONS_STRING = ORDER_FIXED_OPTIONS.map(
  (perm, i) => `${ORDER_CIRCLED[i]} ${perm}`,
).join(' ### ');

type Change = { id: string; source: string; action: string; detail: string };
const planned: Change[] = [];
const skipped: Change[] = [];

function qd(doc: Record<string, unknown> | null): Record<string, unknown> {
  return (doc?.question_data ?? {}) as Record<string, unknown>;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();

  // ── 1. 순서 24번 CorrectAnswer ④ → ①
  {
    const doc = await col.findOne({ _id: new ObjectId(ORDER_ANSWER_FIX_ID) });
    const d = qd(doc);
    const ca = String(d.CorrectAnswer ?? '').trim();
    const expl = String(d.Explanation ?? '');
    if (!doc || doc.type !== '순서' || ca !== '④' || !isStandardOrderOptions(d.Options) || !expl.includes('(A)-(C)-(B)가 정답')) {
      skipped.push({
        id: ORDER_ANSWER_FIX_ID,
        source: String(doc?.source ?? '(없음)'),
        action: '순서 정답 수정',
        detail: `사전 조건 불일치 (type=${doc?.type}, CA=${ca}) — 수동 확인 필요`,
      });
    } else {
      planned.push({
        id: ORDER_ANSWER_FIX_ID,
        source: String(doc.source ?? ''),
        action: '순서 정답 수정',
        detail: 'CorrectAnswer ④ → ① (읽기 순서 (A)-(C)-(B), 해설과 정합)',
      });
      if (APPLY) {
        await col.updateOne(
          { _id: doc._id },
          { $set: { 'question_data.CorrectAnswer': '①', updated_at: now } },
        );
      }
    }
  }

  // ── 2. 어법 34번 ④ <u>do</u> → <u>does</u>
  {
    const doc = await col.findOne({ _id: new ObjectId(GRAMMAR_FIX_ID) });
    const d = qd(doc);
    const para = String(d.Paragraph ?? '');
    const needle = '④ <u>do</u>';
    const count = para.split(needle).length - 1;
    if (!doc || doc.type !== '어법' || count !== 1) {
      skipped.push({
        id: GRAMMAR_FIX_ID,
        source: String(doc?.source ?? '(없음)'),
        action: '어법 wrongForm 적용',
        detail: `사전 조건 불일치 (needle ${count}회) — 수동 확인 필요`,
      });
    } else {
      planned.push({
        id: GRAMMAR_FIX_ID,
        source: String(doc.source ?? ''),
        action: '어법 wrongForm 적용',
        detail: 'Paragraph ④ <u>do</u> → ④ <u>does</u> (해설의 "wrongForm으로 does" 와 정합)',
      });
      if (APPLY) {
        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              'question_data.Paragraph': para.replace(needle, '④ <u>does</u>'),
              updated_at: now,
            },
          },
        );
      }
    }
  }

  // ── 3. 요약 4건 — Question 의 「→ 요약문」을 Paragraph 하단으로 이동
  for (const id of SUMMARY_FIX_IDS) {
    const doc = await col.findOne({ _id: new ObjectId(id) });
    const d = qd(doc);
    const question = String(d.Question ?? '');
    const para = String(d.Paragraph ?? '');
    const m = question.match(/^([\s\S]*?)\n\s*\n→\s*([\s\S]+)$/);
    const summary = m?.[2]?.trim() ?? '';
    const paraHasAB = para.includes('(A)') || para.includes('(B)');
    if (!doc || doc.type !== '요약' || !m || paraHasAB || !summary.includes('(A)') || !summary.includes('(B)')) {
      skipped.push({
        id,
        source: String(doc?.source ?? '(없음)'),
        action: '요약문 이동',
        detail: '사전 조건 불일치 (→ 패턴/(A)(B) 위치) — 수동 확인 필요',
      });
      continue;
    }
    const newQuestion = m[1].trim();
    const newPara = `${para.trimEnd()}\n\n${summary}`;
    const firstA = Math.min(
      newPara.indexOf('(A)') >= 0 ? newPara.indexOf('(A)') : Number.POSITIVE_INFINITY,
      newPara.indexOf('(B)') >= 0 ? newPara.indexOf('(B)') : Number.POSITIVE_INFINITY,
    );
    if (!(firstA / newPara.length >= 0.3)) {
      skipped.push({ id, source: String(doc.source ?? ''), action: '요약문 이동', detail: '이동 후에도 (A) 위치가 전반 30% 안 — 수동 확인 필요' });
      continue;
    }
    planned.push({
      id,
      source: String(doc.source ?? ''),
      action: '요약문 이동',
      detail: `Question → Paragraph 하단: "${summary.slice(0, 60)}…"`,
    });
    if (APPLY) {
      await col.updateOne(
        { _id: doc._id },
        {
          $set: {
            'question_data.Question': newQuestion,
            'question_data.Paragraph': newPara,
            updated_at: now,
          },
        },
      );
    }
  }

  // ── 4. 순서 비표준 보기 배열 — 고정 세트로 교체 + 정답 재매핑
  {
    const docs = await col
      .find({ textbook: TEXTBOOK, type: '순서', deleted_at: null })
      .toArray();
    for (const doc of docs) {
      const d = qd(doc);
      if (isStandardOrderOptions(d.Options)) continue;
      const id = String(doc._id);
      const source = String(doc.source ?? '');
      const perms = parseOrderOptions(d.Options).map(normalizeOrderOption);
      const ca = String(d.CorrectAnswer ?? '').trim();
      const caIdx = (ORDER_CIRCLED as readonly string[]).indexOf(ca);
      const answerPerm = caIdx >= 0 ? perms[caIdx] : undefined;
      const newIdx = answerPerm ? (ORDER_FIXED_OPTIONS as readonly string[]).indexOf(answerPerm) : -1;
      if (perms.length !== 5 || caIdx < 0 || newIdx < 0) {
        skipped.push({
          id,
          source,
          action: '순서 보기 표준화',
          detail: `정답 순열을 고정 세트로 매핑 불가 (CA=${ca}, perm=${answerPerm ?? '?'}) — 재생성 필요`,
        });
        continue;
      }
      const newCa = ORDER_CIRCLED[newIdx];
      const expl = String(d.Explanation ?? '');
      const explNeedsUpdate = newCa !== ca && expl.includes(ca);
      const set: Record<string, unknown> = {
        'question_data.Options': STANDARD_OPTIONS_STRING,
        'question_data.CorrectAnswer': newCa,
        updated_at: now,
      };
      if (explNeedsUpdate) set['question_data.Explanation'] = expl.split(ca).join(newCa);
      planned.push({
        id,
        source,
        action: '순서 보기 표준화',
        detail: `CA ${ca} → ${newCa} (정답 순열 ${answerPerm})${explNeedsUpdate ? ' + 해설 번호 치환' : ''}`,
      });
      if (APPLY) {
        await col.updateOne({ _id: doc._id }, { $set: set });
      }
    }
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, plannedCount: planned.length, planned, skippedCount: skipped.length, skipped }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
