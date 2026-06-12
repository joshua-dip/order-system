/**
 * 26년 6월 고1 영어모의고사 — 어휘 완전 중복 잉여본 3건 하드 삭제 (2026-06-12).
 *
 * 어휘 6종 세트 생성 시 슬롯이 겹쳐 Options·CorrectAnswer 가 완전히 동일한
 * 복사본이 생긴 케이스. 각 그룹의 최초 생성본은 보존:
 *   · 25번: ④ same→different (CA ④) ×3 — 6a249b72…(06-06, 보존),
 *     6a27e7da…b11 · 6a27e7da…b16 삭제
 *   · 35번: ② lower→higher (CA ②) ×2 — 6a27fd30…ca1(보존), 6a27fd30…ca5 삭제
 *
 * 가드: 삭제 대상의 Options·CorrectAnswer 가 기대 시그니처와 정확히 일치하고
 *       보존본이 같은 시그니처로 존재할 때만 삭제.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-vocab-dedup-20260612.ts [--apply]
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
const TEXTBOOK = '26년 6월 고1 영어모의고사';

const GROUPS = [
  {
    source: '26년 6월 고1 영어모의고사 25번',
    options: '① extent ### ② except ### ③ at all ### ④ different ### ⑤ lowest',
    correctAnswer: '④',
    keepId: '6a249b72d0c597982468bccb',
    deleteIds: ['6a27e7da1eb4791424896b11', '6a27e7da1eb4791424896b16'],
  },
  {
    source: '26년 6월 고1 영어모의고사 35번',
    options: '① improved ### ② higher ### ③ reducing ### ④ mindfulness ### ⑤ reduced',
    correctAnswer: '②',
    keepId: '6a27fd3029eaf33fdfbfbca1',
    deleteIds: ['6a27fd3029eaf33fdfbfbca5'],
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const report: Record<string, unknown>[] = [];
  let deletedTotal = 0;

  for (const g of GROUPS) {
    const sig = (doc: Record<string, unknown> | null) => {
      const qd = (doc?.question_data ?? {}) as Record<string, unknown>;
      return (
        !!doc &&
        doc.textbook === TEXTBOOK &&
        doc.type === '어휘' &&
        String(qd.Options ?? '').trim() === g.options &&
        String(qd.CorrectAnswer ?? '').trim() === g.correctAnswer
      );
    };

    const keeper = await col.findOne({ _id: new ObjectId(g.keepId) });
    if (!sig(keeper)) {
      report.push({ source: g.source, error: '보존본 시그니처 불일치 — 그룹 건너뜀' });
      continue;
    }

    for (const id of g.deleteIds) {
      const target = await col.findOne({ _id: new ObjectId(id) });
      if (!sig(target)) {
        report.push({ source: g.source, id, error: '삭제 대상 시그니처 불일치 — 건너뜀' });
        continue;
      }
      report.push({ source: g.source, id, action: APPLY ? '삭제' : '삭제 예정', keep: g.keepId });
      if (APPLY) {
        const r = await col.deleteOne({ _id: new ObjectId(id) });
        deletedTotal += r.deletedCount;
      }
    }
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, deletedTotal, report }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
