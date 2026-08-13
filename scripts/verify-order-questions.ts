/**
 * 주문 범위 변형문제 전수 재검증 (read-only).
 *
 *   npx tsx scripts/verify-order-questions.ts <BV-…|MV-…>
 *
 * cc:audit / tmp-audit-order 가 쓰는 lib 검증과 별개로, 지문 원문을 직접 읽어
 * 「문항이 그 지문에서 제대로 파생됐는지」를 유형별로 다시 확인한다.
 * (prevalidate-variants.ts 와 같은 규칙을 DB 문항에 적용)
 *
 *   공통      Question/Explanation 존재 · CorrectAnswer 형식 · 보기 5개·번호·중복
 *   삽입류    마커 ①~⑤ 5개·순서 · 주어진 문장이 원문에 있고 본문엔 없을 것 ·
 *             마커를 걷어내면 나머지 원문 문장이 남아 있을 것
 *   빈칸류    빈칸 표식 · 정답 문구가 본문에 노출되지 않을 것
 *   순서류    고정 5세트 · (A)(B)(C) 블록 · 정답 순열대로 이으면 원문 복원
 *   함의류    Question 의 밑줄 표현이 본문에 <u>…</u> 로 있을 것
 *   어법류    마커·<u> 각 5개 · 해설이 정답 번호를 설명할 것 (고난도는 복수 정답)
 *   어휘류    보기 5개가 본문 ①~⑤ 표시 뒤 표현과 순서대로 일치
 *   요약류    (A)/(B) 구조
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { passagesForMockVariantOrder } from '@/lib/mock-variant-order';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import {
  computeReadingOrderKey, correctAnswerFromOwnOptions, findPositionInOriginal,
  parseOrderParagraph, readingKeyToPerm,
} from '@/lib/order-variant-validation';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();
const base = (t: string) => t.replace(/-고난도$/, '');

async function main() {
  const orderNumber = (process.argv[2] ?? '').trim();
  if (!orderNumber) { console.log('사용: npx tsx scripts/verify-order-questions.ts <BV-…|MV-…>'); process.exit(1); }

  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) { console.error('주문 없음'); process.exit(1); }

  const meta = (order.orderMeta ?? {}) as Record<string, unknown>;
  let passageDocs: Record<string, unknown>[] = [];
  if (Array.isArray(meta.selectedLessons) && typeof meta.selectedTextbook === 'string') {
    const lessons = [...new Set((meta.selectedLessons as unknown[]).map((l) => String(l).trim()).filter(Boolean))];
    passageDocs = await db.collection('passages')
      .find({ textbook: meta.selectedTextbook, source_key: { $in: lessons } }).toArray();
  } else if (meta.examSelections) {
    const r = await passagesForMockVariantOrder(db.collection('passages'), meta.examSelections);
    passageDocs = r.passageDocs as Record<string, unknown>[];
  } else { console.error('지문 선택 정보 없음'); process.exit(1); }

  const toOid = (v: unknown) => (v instanceof ObjectId ? v : (typeof v === 'string' && ObjectId.isValid(v) ? new ObjectId(v) : null));
  const ids = passageDocs.map((p) => toOid(p.original_passage_id) ?? (p._id as ObjectId));

  const sentMap = new Map<string, string[]>();
  const origMap = new Map<string, string>();
  for (const p of await db.collection('passages').find({ _id: { $in: ids } }).toArray()) {
    const c = (p.content ?? {}) as Record<string, unknown>;
    sentMap.set(String(p._id), Array.isArray(c.sentences_en) ? (c.sentences_en as string[]) : []);
    if (typeof c.original === 'string') origMap.set(String(p._id), c.original);
  }

  const docs = await db.collection('generated_questions')
    .find({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: ids.map(String) } }], deleted_at: null })
    .toArray();

  console.log(`${orderNumber} — 지문 ${passageDocs.length} · 문항 ${docs.length}\n`);

  const errs: string[] = [];
  const skip: string[] = [];
  const byType = new Map<string, number>();

  for (const d of docs) {
    const q = ((d as Record<string, unknown>).question_data ?? {}) as Record<string, unknown>;
    const type = String(d.type ?? '');
    const b = base(type);
    const tag = `${d.source} | ${type} | ${d._id}`;
    byType.set(type, (byType.get(type) ?? 0) + 1);
    const P = String(q.Paragraph ?? '');
    const SENT = sentMap.get(String(d.passage_id)) ?? [];

    if (!String(q.Question ?? '').trim()) errs.push(`${tag} — Question 없음`);
    if (!String(q.Explanation ?? '').trim()) errs.push(`${tag} — Explanation 없음`);

    const optRaw = q.Options;
    if (Array.isArray(optRaw)) { errs.push(`${tag} — Options 배열 저장`); continue; }
    // 보기 구분은 프로젝트 표준(### 우선, 없으면 줄바꿈 — 레거시 다수 포맷)
    const opts = splitQuestionOptionSegments(String(optRaw ?? ''));
    const ca = String(q.CorrectAnswer ?? '').trim();

    const isSubjective = !ca && opts.length === 0;
    if (isSubjective) { skip.push(`${tag} — 서술형(보기·정답 없음)`); continue; }

    if (b === '어법') {
      if (![...ca].every((c) => (CIRCLED as readonly string[]).includes(c)) || !ca.length) errs.push(`${tag} — CorrectAnswer 형식 ${ca}`);
      if (type.endsWith('-고난도') && [...ca].length < 2) errs.push(`${tag} — 고난도 어법인데 정답 ${ca} 1개`);
      for (const c of [...ca]) if (!String(q.Explanation ?? '').includes(c)) errs.push(`${tag} — 해설에 ${c} 설명 없음`);
    } else if (!CIRCLED.includes(ca as typeof CIRCLED[number])) {
      errs.push(`${tag} — CorrectAnswer 형식 ${ca}`);
    }

    // 보기 5개 유형
    const fiveOpt = ['빈칸', '함의', '주제', '제목', '주장', '일치', '불일치', '요약', '어휘', '무관한문장'].includes(b);
    if (fiveOpt) {
      if (opts.length !== 5) errs.push(`${tag} — 보기 ${opts.length}개`);
      else {
        for (const o of opts) if (!/^[①②③④⑤]/.test(o)) errs.push(`${tag} — 보기 번호 없음: ${o.slice(0, 30)}`);
        const bare = opts.map((o) => norm(o.replace(/^[①②③④⑤]\s*/, '')));
        if (new Set(bare).size !== bare.length) errs.push(`${tag} — 보기 중복`);
        if (b === '빈칸') {
          if (!/_{5,}/.test(P)) errs.push(`${tag} — 빈칸 표식 없음`);
          const ans = bare[CIRCLED.indexOf(ca as typeof CIRCLED[number])] ?? '';
          if (ans && norm(P).includes(ans)) errs.push(`${tag} — 정답 문구가 본문에 노출됨`);
        }
      }
    }

    if (b === '어휘' && opts.length === 5) {
      for (let i = 0; i < 5; i += 1) {
        const word = norm(opts[i].replace(/^[①②③④⑤]\s*/, ''));
        const m = P.match(new RegExp(`${CIRCLED[i]}\\s*(?:<u>)?\\s*([^\\s<,.;:)]+)`));
        const seen = (m?.[1] ?? '').trim();
        if (!seen) errs.push(`${tag} — 본문에 ${CIRCLED[i]} 표시 없음`);
        else if (!word.startsWith(seen) && !seen.startsWith(word.split(/\s+/)[0])) {
          errs.push(`${tag} — ${CIRCLED[i]} 본문="${seen}" ≠ 보기="${word}"`);
        }
      }
    }

    if (b === '삽입') {
      const marks = (P.match(/[①②③④⑤]/g) ?? []).join('');
      if (marks !== '①②③④⑤') errs.push(`${tag} — 마커 ${marks || '없음'}`);
      const given = (P.split('\n\n')[0] ?? '').trim();
      const body = P.split('\n\n').slice(1).join(' ');
      if (!body) { errs.push(`${tag} — 주어진 문장/본문 분리 실패`); }
      else {
        if (SENT.length && !SENT.some((s) => norm(s) === norm(given))) skip.push(`${tag} — 주어진 문장이 원문 문장과 불일치(브릿지 문장 가능)`);
        if (norm(body).includes(norm(given))) errs.push(`${tag} — 주어진 문장이 본문에도 남아있음(유출)`);
        const restored = norm(body.replace(/[①②③④⑤]/g, ' '));
        for (const s of SENT) {
          if (norm(s) === norm(given)) continue;
          if (!restored.includes(norm(s))) { skip.push(`${tag} — 본문에 원문 문장 누락(발췌 가능): ${s.slice(0, 40)}…`); break; }
        }
      }
    }

    if (b === '순서') {
      // 정답 검증은 프로젝트 표준(lib/order-variant-validation) — (A)(B)(C) 각 덩이가
      // 원문에서 등장하는 위치 순서와 정답 순열이 일치하는지 본다. 발췌 출제도 통과.
      if (opts.length !== 5) errs.push(`${tag} — 보기 ${opts.length}개`);
      const parsed = parseOrderParagraph(P);
      const original = origMap.get(String(d.passage_id));
      if (!parsed) errs.push(`${tag} — (A)(B)(C) 블록 파싱 실패`);
      else if (!original) skip.push(`${tag} — 원문 없어 정답 대조 불가`);
      else {
        const pos = {
          A: findPositionInOriginal(original, parsed.A),
          B: findPositionInOriginal(original, parsed.B),
          C: findPositionInOriginal(original, parsed.C),
        };
        const key = computeReadingOrderKey(pos);
        if (!key) skip.push(`${tag} — 블록을 원문에서 찾지 못해 대조 불가`);
        else if (key === 'ABC') errs.push(`${tag} — 셔플 안 된 불량 문항(readingOrder ABC)`);
        else {
          const expected = correctAnswerFromOwnOptions(q.Options, readingKeyToPerm(key));
          if (expected && expected !== ca) errs.push(`${tag} — 정답 불일치: 저장 ${ca} → 원문 대조 ${expected}`);
        }
      }
    }

    if (b === '함의') {
      const m = String(q.Question ?? '').match(/["“]([^"”]+)["”]/);
      if (!m) errs.push(`${tag} — Question 에 밑줄 표현 없음`);
      else if (!P.includes(`<u>${m[1]}</u>`)) errs.push(`${tag} — 본문에 <u> 밑줄 없음: ${m[1].slice(0, 40)}`);
    }

    if (b === '어법') {
      const marks = (P.match(/[①②③④⑤]/g) ?? []).join('');
      if (marks !== '①②③④⑤') errs.push(`${tag} — 마커 ${marks || '없음'}`);
      const u = (P.match(/<u>/g) ?? []).length, uc = (P.match(/<\/u>/g) ?? []).length;
      if (u !== 5 || uc !== 5) errs.push(`${tag} — <u> ${u}/${uc}`);
    }

    if (b === '요약') {
      if (!P.includes('(A)') || !P.includes('(B)')) {
        const qq = String(q.Question ?? '');
        if (!qq.includes('(A)') || !qq.includes('(B)')) errs.push(`${tag} — 요약 (A)/(B) 없음`);
      }
    }
  }

  console.log('유형별 문항 수');
  for (const [t, n] of [...byType].sort((a, b2) => b2[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${t}`);

  console.log(`\n참고(정보) ${skip.length}건`);
  for (const s of skip.slice(0, 20)) console.log(`  ${s}`);
  if (skip.length > 20) console.log(`  … 외 ${skip.length - 20}건`);

  if (errs.length) {
    console.log(`\n❌ 오류 ${errs.length}건`);
    for (const e of errs) console.log(`  ${e}`);
    process.exit(1);
  }
  console.log('\n✅ 오류 0건');
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
