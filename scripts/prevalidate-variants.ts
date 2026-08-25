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
 *   삽입-고난도  마커 ①~⑤ 정확히 5개·순서 · 주어진 문장이 원문에 있고 본문엔 없을 것 ·
 *                마커를 걷어내면 나머지 원문 문장이 모두 남아 있을 것
 *   빈칸-고난도  빈칸 표식 · 보기 5개·①~⑤ 접두사·중복 없음 · 정답 문구가 본문에 노출되지 않을 것
 *   순서-고난도  고정 5세트 · 블록 (A)(B)(C) · **정답 순열대로 이으면 원문이 복원될 것**
 *   함의-고난도  Question 의 밑줄 표현이 본문에 <u>…</u> 로 있을 것 · 보기 5개
 *   어법-고난도  마커·<u> 각 5개 · 복수 정답 · 해설이 각 정답 번호를 설명할 것
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();

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
    if (base !== '어법' && !CIRCLED.includes(String(q.CorrectAnswer) as typeof CIRCLED[number])) {
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
        if (!/\.{3}|…|\s-\s|\/|,/.test(bare)) errs.push(`${tag} 보기가 (A)/(B) 쌍이 아님: ${bare.slice(0, 30)}`);
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

    /* 무관한문장 — 번호 붙은 문장 ①~⑤ + 끼워 넣은 문장이 원문에 없어야 한다. */
    if (base === '무관한문장') {
      const marks = P.match(/[①②③④⑤]/g) ?? [];
      if (marks.join('') !== '①②③④⑤') errs.push(`${tag} 마커 ${marks.length}개 / 순서 ${marks.join('')}`);
      if (String(q.Options ?? '') !== '①###②###③###④###⑤') errs.push(`${tag} Options 형식 이상`);
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
      const given = (P.split('\n\n')[0] ?? '').trim();
      const body = P.split('\n\n').slice(1).join(' ');
      if (!SENT.some((s) => norm(s) === norm(given))) errs.push(`${tag} 주어진 문장이 원문에 없음`);
      if (norm(body).includes(norm(given))) errs.push(`${tag} 주어진 문장이 본문에도 남아있음(유출)`);
      const restored = norm(body.replace(/[①②③④⑤]/g, ' '));
      for (const s of SENT) {
        if (norm(s) === norm(given)) continue;
        if (!restored.includes(norm(s))) errs.push(`${tag} 본문에 원문 문장 누락: ${s.slice(0, 40)}…`);
      }
    }

    if (base === '빈칸' && !/_{5,}/.test(P)) errs.push(`${tag} 빈칸 표식 없음`);

    if (base === '순서') {
      const expect = ['① (A)-(C)-(B)', '② (B)-(A)-(C)', '③ (B)-(C)-(A)', '④ (C)-(A)-(B)', '⑤ (C)-(B)-(A)'];
      if (opts.join('|') !== expect.join('|')) errs.push(`${tag} 고정 5세트 불일치`);
      const blocks = P.split('###').map((s) => s.trim());
      if (blocks.length !== 4) errs.push(`${tag} 블록 ${blocks.length}개`);
      const label = (b: string) => (b.match(/^\((A|B|C)\)/) ?? [])[1];
      if (blocks.slice(1).map(label).join('') !== 'ABC') errs.push(`${tag} 블록 라벨 순서 이상`);
      const byLabel: Record<string, string> = {};
      for (const b of blocks.slice(1)) { const l = label(b); if (l) byLabel[l] = b.replace(/^\([ABC]\)\s*/, ''); }
      const perm = (expect[CIRCLED.indexOf(String(q.CorrectAnswer) as typeof CIRCLED[number])] ?? '')
        .replace(/^[①②③④⑤]\s*/, '').split('-').map((s) => s.replace(/[()]/g, ''));
      const rebuilt = norm([blocks[0], ...perm.map((l) => byLabel[l] ?? '')].join(' '));
      if (rebuilt !== norm(SENT.join(' '))) errs.push(`${tag} 정답 순서로 원문 복원 실패`);
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
      if (String(q.Options ?? '') !== '①###②###③###④###⑤') errs.push(`${tag} Options 형식 이상`);
      for (const c of [...ans]) if (!String(q.Explanation ?? '').includes(c)) errs.push(`${tag} 해설에 ${c} 설명 없음`);
    }
  }

  console.log(`문항 ${items.length}개 검증`);
  if (errs.length) { console.log(`\n❌ 오류 ${errs.length}건`); for (const e of errs) console.log('  ' + e); process.exit(1); }
  console.log('\n✅ 오류 0건 — 저장 가능');
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
