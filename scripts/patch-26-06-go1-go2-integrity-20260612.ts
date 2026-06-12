/**
 * 26년 6월 고1·고2 — 정합 검증(content-integrity) 발견 항목 수정 (2026-06-12).
 *
 *   A. 해설 선언 번호 치환 (고2 순서 30 + 고1 삽입 4):
 *      저장 시 정답 셔플 후 해설의 번호 프레임이 갱신되지 않은 문항.
 *      순서는 원문 대조로 CA 가 옳음이 확인됐고 해설 본문의 (A)(B)(C) 논증도 CA 와
 *      일치하므로, 해설 안의 구번호(선언 번호)를 CA 로 전부 치환한다.
 *      가드: 해설에 등장하는 동그라미가 「선언 번호」 한 종류뿐일 때만 +
 *            순서는 해설 마지막 순열이 고정 5세트에서 CA 위치와 일치할 때만.
 *   B. 함의 밑줄 래핑 (고1 25): Question 의 「밑줄 친 X」 구문을 Paragraph 에서 찾아
 *      첫 등장을 <u>X</u> 로 감싼다. 가드: 구문이 Paragraph 에 정확히 1회 존재.
 *   C. source 접두사 부착 (고2 175): source 가 「N번」 형태면 textbook 접두사를 붙인다.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-go2-integrity-20260612.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { extractDeclaredAnswer } from '@/lib/content-integrity-validation';
import { ORDER_FIXED_OPTIONS } from '@/lib/order-variant-validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const TB1 = '26년 6월 고1 영어모의고사';
const TB2 = '26년 6월 고2 영어모의고사';

type Row = Record<string, unknown>;
const report: Row[] = [];
const skipped: Row[] = [];

function qd(doc: Record<string, unknown> | null): Record<string, unknown> {
  return (doc?.question_data ?? {}) as Record<string, unknown>;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();

  // ── A. 해설 선언 번호 치환 (순서 + 삽입)
  for (const [textbook, type] of [
    [TB2, '순서'],
    [TB1, '삽입'],
  ] as const) {
    const docs = await col.find({ textbook, type, deleted_at: null }).toArray();
    for (const d of docs) {
      const data = qd(d);
      const ca = String(data.CorrectAnswer ?? '').trim();
      const expl = String(data.Explanation ?? '');
      if (!/^[①②③④⑤]$/.test(ca)) continue;
      const declared = extractDeclaredAnswer(expl);
      if (!declared || declared === ca) continue;

      const circledInExpl = [...new Set(expl.match(/[①②③④⑤]/g) ?? [])];
      if (circledInExpl.length !== 1 || circledInExpl[0] !== declared) {
        skipped.push({ id: String(d._id), source: d.source, type, detail: `해설에 다른 번호 혼재(${circledInExpl.join(',')}) — 수동 확인` });
        continue;
      }
      if (type === '순서') {
        const perms = expl.match(/\([ABC]\)\s*-\s*\([ABC]\)\s*-\s*\([ABC]\)/g) ?? [];
        const last = perms[perms.length - 1]?.replace(/\s+/g, '');
        const idx = last ? (ORDER_FIXED_OPTIONS as readonly string[]).indexOf(last) : -1;
        if (idx < 0 || CIRCLED[idx] !== ca) {
          skipped.push({ id: String(d._id), source: d.source, type, detail: `해설 순열(${last ?? '?'})이 CA(${ca}) 위치와 불일치 — 수동 확인` });
          continue;
        }
      }
      report.push({
        fix: 'A.해설 번호 치환',
        id: String(d._id),
        source: d.source,
        type,
        detail: `${declared} → ${ca}`,
        explHead: expl.slice(0, 80),
      });
      if (APPLY) {
        await col.updateOne(
          { _id: d._id },
          { $set: { 'question_data.Explanation': expl.split(declared).join(ca), updated_at: now } },
        );
      }
    }
  }

  // ── A-2. 해설 번호 특수 케이스 2건 (눈검증 완료)
  {
    // 고2 33번 순서 6a2222308d91251beb10f515 — 본문 논증(C→A→B)은 CA ④와 일치하나
    // 마지막 문장의 순열 문자열과 번호가 둘 다 구버전. 순열+번호 동시 치환.
    const d = await col.findOne({ _id: new ObjectId('6a2222308d91251beb10f515') });
    const data = qd(d);
    const expl = String(data.Explanation ?? '');
    if (d && String(data.CorrectAnswer ?? '').trim() === '④' && expl.includes('(A)-(C)-(B)인 ②')) {
      const newExpl = expl.split('②').join('④').split('(A)-(C)-(B)인 ④').join('(C)-(A)-(B)인 ④');
      report.push({ fix: 'A.해설 번호 치환', id: String(d._id), source: d.source, type: '순서', detail: '② → ④ + 순열 (A)-(C)-(B)→(C)-(A)-(B) [특수]' });
      if (APPLY) {
        await col.updateOne({ _id: d._id }, { $set: { 'question_data.Explanation': newExpl, updated_at: now } });
      }
    } else if (d) {
      skipped.push({ id: String(d?._id), source: d?.source, type: '순서', detail: '특수 케이스 사전 조건 불일치' });
    }
  }
  {
    // 고1 28번 삽입 6a21b390d934b8ce59768ba8 — CA ② 정답 확인.
    // 해설의 「② 위치의 날짜·시간 안내」는 현재 본문 기준 정확하므로 ① 만 ② 로 치환.
    const d = await col.findOne({ _id: new ObjectId('6a21b390d934b8ce59768ba8') });
    const data = qd(d);
    const expl = String(data.Explanation ?? '');
    if (d && String(data.CorrectAnswer ?? '').trim() === '②' && expl.startsWith('정답은 ①번이다') && expl.includes('② 위치의 날짜')) {
      report.push({ fix: 'A.해설 번호 치환', id: String(d._id), source: d.source, type: '삽입', detail: '① → ② (② 참조는 유지) [특수]' });
      if (APPLY) {
        await col.updateOne({ _id: d._id }, { $set: { 'question_data.Explanation': expl.split('①').join('②'), updated_at: now } });
      }
    } else if (d) {
      skipped.push({ id: String(d?._id), source: d?.source, type: '삽입', detail: '특수 케이스 사전 조건 불일치' });
    }
  }

  // ── B. 함의 밑줄 래핑 (고1)
  {
    const docs = await col.find({ textbook: TB1, type: '함의', deleted_at: null }).toArray();
    for (const d of docs) {
      const data = qd(d);
      const para = String(data.Paragraph ?? '');
      const question = String(data.Question ?? '');
      if (!para.trim() || /<u\b/i.test(para)) continue;
      const m = question.match(/밑줄 친\s+(.+?)\s*[이가]\s+다음 글/);
      const phrase = m?.[1]?.trim().replace(/^['"‘“]|['"’”]$/g, '') ?? '';
      if (!phrase) {
        skipped.push({ id: String(d._id), source: d.source, type: '함의', detail: 'Question에서 밑줄 구문 추출 실패 — 수동 확인' });
        continue;
      }
      const count = para.split(phrase).length - 1;
      if (count !== 1) {
        skipped.push({ id: String(d._id), source: d.source, type: '함의', detail: `구문 "${phrase.slice(0, 30)}" 본문 등장 ${count}회 — 수동 확인` });
        continue;
      }
      report.push({
        fix: 'B.함의 밑줄 래핑',
        id: String(d._id),
        source: d.source,
        detail: `<u>${phrase.slice(0, 40)}</u>`,
      });
      if (APPLY) {
        await col.updateOne(
          { _id: d._id },
          { $set: { 'question_data.Paragraph': para.replace(phrase, `<u>${phrase}</u>`), updated_at: now } },
        );
      }
    }
  }

  // ── C. source 접두사 부착 (고2)
  {
    const docs = await col
      .find({ textbook: TB2, deleted_at: null })
      .project({ source: 1, type: 1 })
      .toArray();
    for (const d of docs) {
      const source = String(d.source ?? '').trim();
      if (!source || source.startsWith(TB2)) continue;
      if (!/^\d+(?:~\d+)?번$/.test(source)) {
        skipped.push({ id: String(d._id), source, type: d.type, detail: 'source 형태가 「N번」이 아님 — 수동 확인' });
        continue;
      }
      report.push({ fix: 'C.source 접두사', id: String(d._id), type: d.type, detail: `"${source}" → "${TB2} ${source}"` });
      if (APPLY) {
        await col.updateOne({ _id: d._id }, { $set: { source: `${TB2} ${source}`, updated_at: now } });
      }
    }
  }

  const byFix: Record<string, number> = {};
  for (const r of report) byFix[String(r.fix)] = (byFix[String(r.fix)] ?? 0) + 1;
  console.log(JSON.stringify({ ok: true, apply: APPLY, byFix, total: report.length, skippedCount: skipped.length, skipped, samples: report.slice(0, 12) }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
