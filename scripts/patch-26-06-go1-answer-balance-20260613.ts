/**
 * 26년 6월 고1 — 함의·빈칸 정답 ① 편중 해소 (2026-06-13).
 *
 * 정합 검증 분포 집계: 함의 ① 63.4%(111/175), 빈칸 ① 61.7%(108/175).
 * 생성 배치가 정답을 ①에 몰아 저장한 산물로, 실모 품질 기준(정답 위치 분산)에 어긋남.
 *
 * 방식 — 2-슬롯 스왑 (정답 텍스트는 그대로, 위치만 이동):
 *   · CA=① 문항 중 초과분을 골라 부족 슬롯 t(②~⑤ 라운드로빈)와 보기 텍스트를 맞바꾼다.
 *   · CorrectAnswer ① → t. 해설의 ①·t 참조는 상호 치환(스왑이라 닫힘 — 다른 번호 참조는 불변).
 *   · 유형당 목표: 각 슬롯 35건(175/5) 수준으로 평탄화.
 * 가드: Options 5개·①~⑤ 접두사 정상, CA=①, 해설 치환은 ①·t 문자만.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-answer-balance-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const TB = '26년 6월 고1 영어모의고사';
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const SWAP_PLACEHOLDER = '\u0000';

function stripPrefix(seg: string): string {
  return seg.replace(/^[①②③④⑤]\s*/, '').trim();
}

/** 해설에서 a↔b 동그라미 상호 치환 */
function swapCircled(text: string, a: string, b: string): string {
  return text
    .split(a).join(SWAP_PLACEHOLDER)
    .split(b).join(a)
    .split(SWAP_PLACEHOLDER).join(b);
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();
  const summary: Record<string, unknown> = {};
  const skipped: Record<string, unknown>[] = [];

  for (const type of ['함의', '빈칸']) {
    const docs = await col
      .find({ textbook: TB, type, deleted_at: null })
      .sort({ source: 1, created_at: 1 })
      .toArray();

    // 현재 분포
    const dist: Record<string, number> = Object.fromEntries(CIRCLED.map((c) => [c, 0]));
    for (const d of docs) {
      const ca = String((d.question_data as Record<string, unknown>)?.CorrectAnswer ?? '').trim();
      if (dist[ca] !== undefined) dist[ca] += 1;
    }
    const total = docs.length;
    const target = Math.floor(total / CIRCLED.length); // 175 → 35

    // 슬롯별 부족분 (① 제외) — 라운드로빈 큐 구성
    const deficitQueue: string[] = [];
    for (const c of CIRCLED.slice(1)) {
      for (let i = dist[c]; i < target; i++) deficitQueue.push(c);
    }

    let moved = 0;
    const before = { ...dist };
    for (const d of docs) {
      if (deficitQueue.length === 0) break;
      if (dist['①'] <= target) break;
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const ca = String(qd.CorrectAnswer ?? '').trim();
      if (ca !== '①') continue;
      const raw = String(qd.Options ?? '');
      const segs = splitQuestionOptionSegments(raw);
      if (segs.length !== 5 || !segs.every((s, i) => s.startsWith(CIRCLED[i]))) {
        skipped.push({ id: String(d._id), type, detail: 'Options 형식 비표준 — 건너뜀' });
        continue;
      }
      const t = deficitQueue.shift()!;
      const ti = CIRCLED.indexOf(t);
      const texts = segs.map(stripPrefix);
      [texts[0], texts[ti]] = [texts[ti], texts[0]];
      const newOptions = texts.map((s, i) => `${CIRCLED[i]} ${s}`).join(' ### ');
      const expl = String(qd.Explanation ?? '');
      const newExpl = expl ? swapCircled(expl, '①', t) : expl;

      moved += 1;
      dist['①'] -= 1;
      dist[t] += 1;
      if (APPLY) {
        await col.updateOne(
          { _id: d._id },
          {
            $set: {
              'question_data.Options': newOptions,
              'question_data.CorrectAnswer': t,
              ...(expl ? { 'question_data.Explanation': newExpl } : {}),
              updated_at: now,
            },
          },
        );
      }
    }
    summary[type] = { total, before, after: dist, moved };
  }

  console.log(JSON.stringify({ ok: true, apply: APPLY, summary, skippedCount: skipped.length, skipped: skipped.slice(0, 10) }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
