/**
 * 변형문제 저장 전 오프라인 검증 (read-only).
 *
 *   npx tsx scripts/prevalidate-variants.ts <드래프트.json>
 *
 * 드래프트는 [{ passage_id, textbook, source, type, question_data }, …] 배열.
 * DB 에서 지문 원문을 읽어 「문항이 그 지문에서 제대로 파생됐는지」를 기계적으로 확인한다.
 *
 * cc:variant save 는 dry-run 이 없어 실행 즉시 insert 된다. 잘못 넣으면 지우기 번거로우니
 * 저장 전에 이걸로 0 에러를 확인한다.
 *
 * 유형별로 보는 것:
 *   삽입-고난도  마커 ①~⑤ 정확히 5개·순서 · 본문에 원문이 다 남아 있을 것 ·
 *                주어진 문장은 **새로 쓴 브릿지여도 된다**(고난도의 정상 형태)
 *   빈칸-고난도  빈칸 표식 · 보기 5개·①~⑤ 접두사·중복 없음 · 정답 문구가 본문에 노출되지 않을 것
 *   순서-고난도  고정 5세트 · 블록 (A)(B)(C) · **각 블록의 원문 위치 순서가 정답과 맞을 것**
 *                (바이트 단위 복원이 아니다 — 고난도는 연결어를 지워 단서를 약화하므로)
 *   함의-고난도  Question 의 밑줄 표현이 본문에 <u>…</u> 로 있을 것 · 보기 5개
 *   어법-고난도  마커·<u> 각 5개 · 복수 정답 · 해설이 각 정답 번호를 설명할 것
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';
import { findPositionInOriginal, parseOrderParagraph } from '@/lib/order-variant-validation';
import { ObjectId } from 'mongodb';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();

/**
 * 「번호만 나열」하는 Options(어법·무관한문장)인지.
 *
 * 구분자 주변 공백이 DB 에 두 가지로 섞여 있다 — 저장 상수는 무관한문장이
 * `'① ### ② ### ③ ### ④ ### ⑤'`(공백 O, `lib/variant-save-generated-question.ts`),
 * 어법이 `'①###②###③###④###⑤'`(공백 X, `lib/variant-draft-grammar-rules.ts`) 다.
 * 예전엔 여기서 공백 없는 한 형태만 문자열로 비교해, 규격대로 저장된 무관한문장이
 * 전부 「Options 형식 이상」으로 잡혔다. **공백을 지우고 본다.**
 */
function isNumberOnlyOptions(raw: unknown): boolean {
  return String(raw ?? '')
    .split('###')
    .map((s) => s.trim())
    .join('###') === '①###②###③###④###⑤';
}

interface Draft {
  passage_id: string;
  type: string;
  source?: string;
  question_data: Record<string, string>;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.log('사용법: npx tsx scripts/prevalidate-variants.ts <드래프트.json>'); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(file, 'utf8')) as Draft[];
  const db = await getDb('gomijoshua');

  const cache = new Map<string, string[]>();
  const sentencesOf = async (pid: string): Promise<string[]> => {
    if (cache.has(pid)) return cache.get(pid)!;
    const p = await db.collection('passages').findOne({ _id: new ObjectId(pid) });
    const c = (p?.content ?? {}) as Record<string, unknown>;
    const arr = Array.isArray(c.sentences_en) ? (c.sentences_en as string[]) : [];
    cache.set(pid, arr);
    return arr;
  };

  const errs: string[] = [];
  for (const it of items) {
    const q = it.question_data ?? {};
    const P = String(q.Paragraph ?? '');
    const tag = `[${it.source ?? '?'} ${it.type}]`;
    /* 기본 유형과 -고난도 는 구조 규칙이 같다. 예전엔 -고난도 만 검사해서
       기본 유형 주문(부교재 BV)은 구조 검증 없이 통과했다. */
    const base = it.type.replace(/-고난도$/, '');
    const isAdvanced = it.type.endsWith('-고난도');
    const SENT = await sentencesOf(it.passage_id);
    if (!SENT.length) { errs.push(`${tag} 지문을 찾을 수 없음 (${it.passage_id})`); continue; }

    if (!String(q.Question ?? '').trim()) errs.push(`${tag} Question 없음`);
    if (!String(q.Explanation ?? '').trim()) errs.push(`${tag} Explanation 없음`);
    if (/\bnan\b|undefined|null/i.test(String(q.Explanation ?? ''))) errs.push(`${tag} Explanation 이상값`);
    /* 복수 정답이 **규격인** 유형 — 어법 계열과 어휘-고난도.
       저장 경로(`saveGeneratedQuestionToDb`)가 어휘-고난도에 복수 동그라미(예: ②⑤)를
       강제하는데, 예전엔 어법만 예외로 둬서 정상 문항이 「CorrectAnswer 형식」으로 잡혔다. */
    const isMultiAnswerType = base === '어법' || it.type === '어휘-고난도';
    if (!isMultiAnswerType && !CIRCLED.includes(String(q.CorrectAnswer) as typeof CIRCLED[number])) {
      errs.push(`${tag} CorrectAnswer 형식: ${q.CorrectAnswer}`);
    }

    const opts = String(q.Options ?? '').split('###').map((s) => s.trim()).filter(Boolean);
    // 보기 5개가 필요한 유형 — 어법·무관한문장(번호만 나열)·순서(고정 5세트)는 따로 본다
    const needFiveOptions = ['빈칸', '함의', '요약', '어휘', '주제', '제목', '주장', '일치', '불일치'].includes(base);
    if (needFiveOptions) {
      if (opts.length !== 5) errs.push(`${tag} 보기 ${opts.length}개`);
      for (const o of opts) if (!/^[①②③④⑤]\s/.test(o)) errs.push(`${tag} 보기 번호 없음: ${o.slice(0, 30)}`);
      const bare = opts.map((o) => norm(o.replace(/^[①②③④⑤]\s*/, '')));
      if (new Set(bare).size !== bare.length) errs.push(`${tag} 보기 중복`);
      const ans = bare[CIRCLED.indexOf(String(q.CorrectAnswer) as typeof CIRCLED[number])] ?? '';
      if (base === '빈칸' && ans && norm(P).includes(ans)) errs.push(`${tag} 정답 문구가 본문에 노출됨`);
    }


    /* 요약 — (A)·(B) 두 빈칸과 보기의 (A)/(B) 쌍이 모두 있어야 한다.
       (A)/(B) 누락은 자동 검수(per-question)가 못 잡고 cc:audit 만 잡던 구멍이다. */
    if (base === '요약') {
      if (!P.includes('(A)') || !P.includes('(B)')) errs.push(`${tag} 요약문에 (A)/(B) 빈칸 없음`);
      for (const o of opts) {
        const bare = o.replace(/^[①②③④⑤]\s*/, '');
        /* 두 낱말을 가르는 자리에 하이픈 말고 **en dash(–)·em dash(—)** 를 쓴 문항이 많다.
           ASCII 하이픈만 보던 탓에 `(A) novelty – (B) responsiveness` 가 전부 불량으로 잡혔다. */
        if (!/\.{3}|…|\s[-–—]\s|\/|,/.test(bare)) errs.push(`${tag} 보기가 (A)/(B) 쌍이 아님: ${bare.slice(0, 30)}`);
      }
    }

    /* 어휘 — 본문에 ①~⑤ 마커와 <u> 5개, 보기는 「① word」 형태.
       맨 단어만 저장하면 저장은 되지만 렌더러가 정답을 못 찾는다. */
    if (base === '어휘') {
      const marks = P.match(/[①②③④⑤]/g) ?? [];
      if (marks.join('') !== '①②③④⑤') errs.push(`${tag} 마커 ${marks.length}개 / 순서 ${marks.join('')}`);
      const u = (P.match(/<u>/g) ?? []).length;
      if (u !== 5) errs.push(`${tag} <u> ${u}개 (5개여야 함)`);
      for (const o of opts) if (!/^[①②③④⑤]\s+\S/.test(o)) errs.push(`${tag} 보기 번호 접두사 없음: ${o.slice(0, 30)}`);
    }

    /* 어휘-고난도 — 어법-고난도와 같은 「모두 고르기」다. 정답이 2개 이상이고 해설이 각 번호를 설명해야 한다. */
    if (it.type === '어휘-고난도') {
      const ans = String(q.CorrectAnswer ?? '');
      if (!ans || ![...ans].every((c) => (CIRCLED as readonly string[]).includes(c))) {
        errs.push(`${tag} CorrectAnswer 형식: ${ans}`);
      } else {
        if ([...ans].length < 2) errs.push(`${tag} 복수 정답이어야 함 (현재 ${ans})`);
        for (const c of [...ans]) if (!String(q.Explanation ?? '').includes(c)) errs.push(`${tag} 해설에 ${c} 설명 없음`);
      }
    }

    /* 무관한문장 — 번호 붙은 문장 ①~⑤ + 끼워 넣은 문장이 원문에 없어야 한다. */
    if (base === '무관한문장') {
      const marks = P.match(/[①②③④⑤]/g) ?? [];
      if (marks.join('') !== '①②③④⑤') errs.push(`${tag} 마커 ${marks.length}개 / 순서 ${marks.join('')}`);
      if (!isNumberOnlyOptions(q.Options)) errs.push(`${tag} Options 형식 이상: ${String(q.Options ?? '').slice(0, 40)}`);
    }

    /* 일치·불일치 — 보기 5개가 모두 영어 진술문 (한글 보기 금지) */
    if (base === '일치' || base === '불일치') {
      for (const o of opts) {
        if (/[가-힣]/.test(o.replace(/^[①②③④⑤]\s*/, ''))) {
          errs.push(`${tag} 보기에 한글: ${o.slice(0, 30)}`);
        }
      }
    }

    if (base === '삽입') {
      const marks = P.match(/[①②③④⑤]/g) ?? [];
      if (marks.join('') !== '①②③④⑤') errs.push(`${tag} 마커 ${marks.length}개 / 순서 ${marks.join('')}`);
      /* 주어진 문장과 본문을 가르는 표기가 DB 에 두 가지로 섞여 있다
         (`\n###\n` 4,677건 / 빈 줄 4,196건). 한쪽만 보면 나머지 절반을
         「본문에 원문 누락」으로 잘못 잡는다. 둘 다 받는다. */
      const insSep = P.includes('\n###\n') ? '\n###\n' : '\n\n';
      const insParts = P.split(insSep);
      const given = (insParts[0] ?? '').trim();
      const body = insParts.slice(1).join(' ');
      /* 주어진 문장을 원문에서 빼낼지(추출형), 새로 쓸지(브릿지형)는 **난도에 따라 다르다.**
         DB 실물 기준 기본 삽입은 85%가 추출형, 삽입-고난도는 71%가 브릿지형이다
         (`lib/hard-insertion-generator.ts` 의 HARD_INSERTION_PROMPT 가 새 문장 생성을 지시한다).

         - 삽입-고난도: 브릿지형이 정상. 막지 않는다.
           (예전엔 여기서 막아, 에이전트가 고난도를 추출형으로 만들고 "사실상 base 급"이 됐다.)
         - 기본 삽입: 추출형이 규격이다. 다만 원문이 6문장 미만이면 한 문장을 빼는 순간
           본문이 5문장이 안 돼 마커 5개를 만들 수 없으므로 브릿지가 유일한 방법이다. */
      const isBridge = !SENT.some((s) => norm(s) === norm(given));
      if (isBridge && !isAdvanced && SENT.length >= 6) {
        errs.push(`${tag} 기본 삽입은 추출형이어야 함 (주어진 문장이 원문에 없음, 원문 ${SENT.length}문장)`);
      }
      if (norm(body).includes(norm(given))) errs.push(`${tag} 주어진 문장이 본문에도 남아있음(유출)`);
      const restored = norm(body.replace(/[①②③④⑤]/g, ' '));
      for (const s of SENT) {
        if (!isBridge && norm(s) === norm(given)) continue;
        if (!restored.includes(norm(s))) errs.push(`${tag} 본문에 원문 문장 누락: ${s.slice(0, 40)}…`);
      }
    }

    if (base === '빈칸' && !/_{5,}/.test(P)) errs.push(`${tag} 빈칸 표식 없음`);

    if (base === '순서') {
      const expect = ['① (A)-(C)-(B)', '② (B)-(A)-(C)', '③ (B)-(C)-(A)', '④ (C)-(A)-(B)', '⑤ (C)-(B)-(A)'];
      if (opts.join('|') !== expect.join('|')) errs.push(`${tag} 고정 5세트 불일치`);

      /* 블록 구분자는 `\n###\n` 과 빈 줄 두 가지가 DB 에 섞여 있다(순서 8,693건 중 61% : 39%).
         둘 다 렌더러가 처리하므로 `parseOrderParagraph` 로 함께 받는다.
         예전엔 `###` 로만 잘라서, 빈 줄로 쓴 정상 문항이 「블록 1개」로 잡혔다. */
      const parts = parseOrderParagraph(P);
      if (!parts) { errs.push(`${tag} 블록 (A)(B)(C) 파싱 실패`); continue; }

      /* 정답 검증은 **원문 위치 순서**로 한다(cc:audit 의 orderUnified 와 같은 방식).
         바이트 단위 복원을 요구하면 순서-고난도의 단서 약화(덩이 안 연결어 삭제)가
         전부 불량으로 잡힌다 — 실제로 그래서 고난도가 base 급으로 만들어진 적이 있다. */
      const original = SENT.join(' ');
      const pos: Record<'A' | 'B' | 'C', number> = {
        A: findPositionInOriginal(original, parts.A),
        B: findPositionInOriginal(original, parts.B),
        C: findPositionInOriginal(original, parts.C),
      };
      if ((['A', 'B', 'C'] as const).some((l) => pos[l] < 0)) {
        errs.push(`${tag} 블록을 원문에서 못 찾음 (A:${pos.A} B:${pos.B} C:${pos.C}) — 덩이 첫 문장은 원문 그대로 두어야 한다`);
      } else {
        const reading = (['A', 'B', 'C'] as const).slice().sort((x, y) => pos[x] - pos[y]);
        const want = `(${reading[0]})-(${reading[1]})-(${reading[2]})`;
        if (want === '(A)-(B)-(C)') errs.push(`${tag} 미셔플 — 원문 순서 그대로다`);
        const wantAnswer = expect.find((o) => o.endsWith(want))?.[0] ?? '?';
        if (wantAnswer !== String(q.CorrectAnswer ?? '')) {
          errs.push(`${tag} 정답 불일치: 저장=${q.CorrectAnswer} 원문대조=${wantAnswer} ${want}`);
        }
      }
    }

    if (base === '함의') {
      const m = String(q.Question ?? '').match(/"([^"]+)"/);
      if (!m) errs.push(`${tag} Question 에 밑줄 표현 없음`);
      else if (!P.includes(`<u>${m[1]}</u>`)) errs.push(`${tag} 본문에 <u> 밑줄 없음`);
    }

    if (base === '어법') {
      const marks = P.match(/[①②③④⑤]/g) ?? [];
      if (marks.join('') !== '①②③④⑤') errs.push(`${tag} 마커 ${marks.length}개 / 순서 ${marks.join('')}`);
      const u = (P.match(/<u>/g) ?? []).length, uc = (P.match(/<\/u>/g) ?? []).length;
      if (u !== 5 || uc !== 5) errs.push(`${tag} <u> ${u}/${uc}`);
      const ans = String(q.CorrectAnswer ?? '');
      if (![...ans].every((c) => (CIRCLED as readonly string[]).includes(c))) errs.push(`${tag} CorrectAnswer 형식: ${ans}`);
      // 복수 정답은 고난도만. 기본 어법은 1개.
      if (isAdvanced && [...ans].length < 2) errs.push(`${tag} 복수 정답이어야 함 (현재 ${ans})`);
      if (!isAdvanced && [...ans].length !== 1) errs.push(`${tag} 기본 어법은 정답 1개여야 함 (현재 ${ans})`);
      if (!isNumberOnlyOptions(q.Options)) errs.push(`${tag} Options 형식 이상: ${String(q.Options ?? '').slice(0, 40)}`);
      for (const c of [...ans]) if (!String(q.Explanation ?? '').includes(c)) errs.push(`${tag} 해설에 ${c} 설명 없음`);
    }
  }

  console.log(`문항 ${items.length}개 검증`);
  if (errs.length) { console.log(`\n❌ 오류 ${errs.length}건`); for (const e of errs) console.log('  ' + e); process.exit(1); }
  console.log('\n✅ 오류 0건 — 저장 가능');
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
