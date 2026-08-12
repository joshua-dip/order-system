/**
 * 무관한문장 계열 정답 번호 쏠림 보정.
 *
 *   npx tsx scripts/rebalance-irrelevant-answer.ts --dry-run
 *   npx tsx scripts/rebalance-irrelevant-answer.ts --textbook "교재명" --dry-run
 *   npx tsx scripts/rebalance-irrelevant-answer.ts --textbook "교재명" --apply
 *   npx tsx scripts/rebalance-irrelevant-answer.ts --revert --textbook "교재명"   # 되돌리기
 *
 * 배경: 완료 문항 2,414건의 정답이 ① 4% / ② 25% / ③ 37% / ④ 26% / ⑤ 8% 로 쏠려 있었다.
 * 학생이 "①·⑤ 는 답이 아니다" 를 학습해 5지선다가 사실상 3지선다가 된다.
 *
 * 방법: 무관한 문장은 지문 흐름과 무관하므로, **그 문장만 다른 자리로 옮기고 번호를 다시 매기면**
 * 나머지 문장의 상대 순서가 그대로라 지문이 깨지지 않는다. 내용은 한 글자도 바꾸지 않는다.
 *
 * 해설이 ①~⑤ 를 전부 언급하므로(400건 표본 100%), 자리 이동으로 생긴 번호 치환을
 * 해설에도 똑같이 적용한다. 안 하면 「④에서 휴재를 공지하고」 같은 문장이 어긋난다.
 *
 * 목표 분포(완만한 보정): ① 12% · ⑤ 15% · ②③④ 나머지 균등.
 * 실제 수능도 무관한문장은 ① 이 드물어서, 완전 균등(20%)으로 맞추면 실전 감각과 멀어진다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';
import type { ObjectId } from 'mongodb';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const TYPES = ['무관한문장', '무관한문장-고난도'];

/** 목표 비율 — ①·⑤ 만 끌어올리고 ②③④ 는 나머지를 고르게 */
const TARGET_FIRST = 0.12;
const TARGET_LAST = 0.15;

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const revert = argv.includes('--revert');
const tbIdx = argv.indexOf('--textbook');
const onlyTextbook = tbIdx >= 0 ? argv[tbIdx + 1] : '';

interface Split { intro: string; parts: string[] }

/** Paragraph → 도입부 + ①~⑤ 문장. 마커가 없거나 순서가 뒤엉키면 null */
function splitMarked(p: string): Split | null {
  const idx = CIRCLED.map((c) => p.indexOf(c));
  if (idx.some((i) => i < 0)) return null;
  for (let i = 1; i < 5; i++) if (idx[i] < idx[i - 1]) return null;
  const parts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const from = idx[i] + CIRCLED[i].length;
    const to = i === 4 ? p.length : idx[i + 1];
    parts.push(p.slice(from, to).trim());
  }
  return { intro: p.slice(0, idx[0]).trim(), parts };
}

/** 도입부 + 문장들 → Paragraph. splitMarked 의 역함수여야 한다(자기검증에서 확인) */
function compose(s: Split, parts: string[]): string {
  return [s.intro, ...parts.map((t, i) => `${CIRCLED[i]} ${t}`)].filter(Boolean).join(' ');
}

/** 해설 안의 ①~⑤ 를 한 번에 치환 (순차 치환하면 이미 바꾼 걸 또 바꾼다) */
function remapCircled(text: string, oldToNew: number[]): string {
  return text.replace(/[①②③④⑤]/g, (ch) => {
    const from = CIRCLED.indexOf(ch as (typeof CIRCLED)[number]);
    return from < 0 ? ch : CIRCLED[oldToNew[from]];
  });
}

/** 무관한 문장을 from 자리에서 to 자리로 옮겼을 때의 옛번호 → 새번호 */
function permutationFor(from: number, to: number): number[] {
  const order = [...Array(5).keys()];          // 옛 슬롯 인덱스를 담은 새 배열
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const oldToNew = Array(5).fill(0);
  order.forEach((oldSlot, newSlot) => { oldToNew[oldSlot] = newSlot; });
  return oldToNew;
}

type Doc = { _id: ObjectId; textbook?: string; question_data?: Record<string, unknown>; answerRebalance?: unknown };

async function main() {
  const db = await getDb('gomijoshua');
  const C = db.collection('generated_questions');
  const filter: Record<string, unknown> = { type: { $in: TYPES }, status: '완료' };
  if (onlyTextbook) filter.textbook = onlyTextbook;

  if (revert) {
    const targets = await C.find({ ...filter, answerRebalance: { $exists: true } }).toArray();
    console.log(`되돌릴 문항 ${targets.length}건`);
    if (!apply) { console.log('미리보기입니다. --apply 를 붙이세요.'); return; }
    let n = 0;
    for (const d of targets as Doc[]) {
      const bk = d.answerRebalance as { prevParagraph: string; prevAnswer: string; prevExplanation: string };
      await C.updateOne({ _id: d._id }, {
        $set: {
          'question_data.Paragraph': bk.prevParagraph,
          'question_data.CorrectAnswer': bk.prevAnswer,
          'question_data.Explanation': bk.prevExplanation,
        },
        $unset: { answerRebalance: '' },
      });
      n++;
    }
    console.log(`✅ ${n}건 원복`);
    return;
  }

  const docs = (await C.find(filter).toArray()) as Doc[];

  // 재배치 가능한 것만 추린다
  const items: { d: Doc; s: Split; ans: number }[] = [];
  let skipped = 0;
  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const ans = CIRCLED.indexOf(String(qd.CorrectAnswer ?? '').trim() as (typeof CIRCLED)[number]);
    const s = splitMarked(String(qd.Paragraph ?? ''));
    if (ans < 0 || !s || s.parts.some((x) => !x)) { skipped++; continue; }
    // 자기검증: 안 옮겼을 때 원문이 그대로 복원되는가
    if (compose(s, s.parts) !== String(qd.Paragraph ?? '').trim()) { skipped++; continue; }
    items.push({ d, s, ans });
  }

  const dist = [0, 0, 0, 0, 0];
  for (const it of items) dist[it.ans]++;
  const total = items.length;
  console.log(`대상 ${docs.length}건 · 재배치 가능 ${total}건 · 건너뜀 ${skipped}건`);
  console.log(`현재: ${dist.map((v, i) => `${CIRCLED[i]} ${v}(${Math.round(v / total * 100)}%)`).join('  ')}`);

  const want = [0, 0, 0, 0, 0];
  want[0] = Math.round(total * TARGET_FIRST);
  want[4] = Math.round(total * TARGET_LAST);
  const mid = total - want[0] - want[4];
  want[1] = Math.round(mid / 3); want[2] = Math.round(mid / 3);
  want[3] = mid - want[1] - want[2];
  console.log(`목표: ${want.map((v, i) => `${CIRCLED[i]} ${v}(${Math.round(v / total * 100)}%)`).join('  ')}`);

  // 넘치는 칸에서 모자란 칸으로 옮긴다. 같은 칸 안에서는 지문이 긴 것부터(눈에 덜 띄게)
  const need = want.map((w, i) => w - dist[i]);
  const donors = [1, 2, 3].filter((i) => need[i] < 0).sort((a, b) => need[a] - need[b]);
  const plan: { it: typeof items[number]; to: number }[] = [];
  for (const to of [0, 4]) {
    let remain = Math.max(0, need[to]);
    for (const from of donors) {
      if (remain <= 0) break;
      let avail = Math.max(0, -need[from] - plan.filter((p) => p.it.ans === from).length);
      const pool = items.filter((it) => it.ans === from && !plan.some((p) => p.it === it));
      while (remain > 0 && avail > 0 && pool.length) {
        plan.push({ it: pool.shift()!, to });
        remain--; avail--;
      }
    }
  }

  const after = [...dist];
  for (const p of plan) { after[p.it.ans]--; after[p.to]++; }
  console.log(`\n이동 ${plan.length}건 → 결과: ${after.map((v, i) => `${CIRCLED[i]} ${v}(${Math.round(v / total * 100)}%)`).join('  ')}`);

  if (!apply) {
    const ex = plan[0];
    if (ex) {
      const perm = permutationFor(ex.it.ans, ex.to);
      console.log(`\n예시 1건: ${CIRCLED[ex.it.ans]} → ${CIRCLED[ex.to]}  (번호 매핑 ${perm.map((n, i) => `${CIRCLED[i]}→${CIRCLED[n]}`).join(' ')})`);
      const parts = [...ex.it.s.parts];
      const [moved] = parts.splice(ex.it.ans, 1);
      parts.splice(ex.to, 0, moved);
      console.log('  변경 후 지문(앞 220자):', compose(ex.it.s, parts).slice(0, 220));
    }
    console.log('\n미리보기입니다. 적용하려면 --apply 를 붙이세요.');
    return;
  }

  let ok = 0;
  for (const { it, to } of plan) {
    const qd = (it.d.question_data ?? {}) as Record<string, unknown>;
    const parts = [...it.s.parts];
    const [moved] = parts.splice(it.ans, 1);
    parts.splice(to, 0, moved);
    const perm = permutationFor(it.ans, to);
    const prevParagraph = String(qd.Paragraph ?? '');
    const prevAnswer = String(qd.CorrectAnswer ?? '');
    const prevExplanation = String(qd.Explanation ?? '');

    await C.updateOne({ _id: it.d._id }, {
      $set: {
        'question_data.Paragraph': compose(it.s, parts),
        'question_data.CorrectAnswer': CIRCLED[to],
        'question_data.Explanation': remapCircled(prevExplanation, perm),
        answerRebalance: { at: new Date(), from: CIRCLED[it.ans], to: CIRCLED[to], prevParagraph, prevAnswer, prevExplanation },
      },
    });
    ok++;
  }
  console.log(`\n✅ ${ok}건 보정 완료 (원본은 answerRebalance 에 보관 — --revert 로 되돌릴 수 있음)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
