import fs from 'node:fs';
import path from 'node:path';
import type { Db } from 'mongodb';
import { normalizeOrderScope } from '@/lib/order-scope';
import {
  computeReadingOrderKey,
  correctAnswerFromOwnOptions,
  findPositionInOriginal,
  parseOrderParagraph,
  readingKeyToPerm,
  type OrderParagraphParts,
} from '@/lib/order-variant-validation';

/**
 * 주문 정답열 교정 공용 로직.
 *
 * 인쇄 순서(출처 순)로 이웃한 문항의 정답이 연달아 같거나(③③) 두 문항씩 같은 패턴으로 반복되면(③④③④)
 * 학생이 번호 패턴으로 풀 수 있다 — 2026-09 선생님 지적("bca bca - cab cab").
 * 문항의 의미는 그대로 두고 정답 번호만 옮긴다.
 *  - 순서   : (A)(B)(C) 라벨만 치환한다. 본문 덩이와 해설 논리는 그대로.
 *  - 삽입   : 마커 자리만 옮긴다. 주어진 문장·본문 글자·문장이 들어갈 자리는 그대로.
 *  - 셔플형 : 정답 보기와 목표 자리 보기 두 개만 맞바꾼다.
 * 번호가 바뀌면 해설의 번호와 조사(①이 ②가 …)도 같이 바꾼다.
 * CLI 는 scripts/cc-answer-seq.ts, 절차는 docs/variant/REVIEW.md §7.
 */

export const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const CIRCLED_LIST: readonly string[] = CIRCLED;

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/* ─────────────── 주문 범위 ─────────────── */

export interface OrderScopeTarget {
  textbook: string;
  sources: string[];
  /** 제목·파일명에 쓰는 범위 표기 — 회차가 있으면 「07회·08회」, 없으면 교재명 */
  label: string;
}

export interface OrderQuestionScope {
  flow: string;
  targets: OrderScopeTarget[];
  types: string[];
  /** 유형당 주문 수량 — 인쇄 때 (출처, 유형)당 이만큼만 낸다 */
  perType: (type: string) => number;
  loginId: string | null;
}

function listAfterHeading(text: string, heading: RegExp): string[] {
  const m = text.match(heading);
  return m ? [...new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean))] : [];
}

function scopeLabel(textbook: string, sources: string[]): string {
  const rounds = [...new Set(sources.map((s) => s.split(' ').find((w) => /회$/.test(w)) ?? ''))]
    .filter(Boolean)
    .sort();
  return rounds.length ? rounds.join('·') : textbook;
}

/** 주문 → 교재·지문·유형·수량. orderMeta(normalizeOrderScope)가 기본이고, 옛 BV 주문은 주문서 본문으로 보강한다. */
export function resolveOrderQuestionScope(order: Doc): OrderQuestionScope {
  const meta = (order.orderMeta && typeof order.orderMeta === 'object' ? order.orderMeta : {}) as Doc;
  const text = str(order.orderText);
  const { scope, flow } = normalizeOrderScope(meta);
  let targets: OrderScopeTarget[] = (scope?.dbEntries ?? []).map((e) => ({
    textbook: e.textbookKey,
    sources: e.selectedSources,
    label: '',
  }));
  if (!targets.some((t) => t.sources.length)) {
    const textbook = (text.match(/교재:\s*(.+)/)?.[1] ?? '').trim();
    const sources = listAfterHeading(text, /1\.\s*필요하신 강과 번호[\s\S]*?\n:\s*([^\n]+)/);
    if (textbook && sources.length) targets = [{ textbook, sources, label: '' }];
  }
  targets = targets
    .filter((t) => t.textbook && t.sources.length)
    .map((t) => ({ ...t, label: scopeLabel(t.textbook, t.sources) }));
  const types = scope?.selectedTypes.length
    ? scope.selectedTypes
    : listAfterHeading(text, /2\.\s*문제 유형[\s\S]*?\n:\s*([^\n]+)/);
  const flat = Number(meta.questionsPerType);
  const perType = (type: string): number => {
    if (Number.isFinite(flat) && flat > 0) return flat;
    const fromMap = flow === 'unifiedVariant' ? scope?.questionsPerTypeMap[type] : undefined;
    return fromMap && fromMap > 0 ? fromMap : 1;
  };
  return { flow, targets, types, perType, loginId: typeof order.loginId === 'string' ? order.loginId : null };
}

export function compareSourceLabel(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true });
}

export const REVIEWABLE_STATUSES = ['대기', '완료', '검수불일치'];

export interface OrderQuestionRow {
  doc: Doc;
  qd: Doc;
  source: string;
  answer: string;
}

/**
 * 주문 범위 문항을 인쇄 순서(출처 순)로. (출처, 유형)당 serialNo 가 앞선 것부터 perSource 개.
 * 인쇄(cc:order-pdf)와 교정(cc:answer-seq)이 같은 순서를 봐야 이웃 판정이 맞는다.
 */
export async function fetchOrderQuestions(
  db: Db,
  target: OrderScopeTarget,
  type: string,
  opts: { statuses?: string[]; perSource?: number } = {},
): Promise<OrderQuestionRow[]> {
  const perSource = opts.perSource ?? 1;
  const docs = (await db
    .collection('generated_questions')
    .find({
      textbook: target.textbook,
      source: { $in: target.sources },
      type,
      status: { $in: opts.statuses ?? REVIEWABLE_STATUSES },
    })
    .sort({ serialNo: 1, _id: 1 })
    .toArray()) as Doc[];
  const bySource = new Map<string, Doc[]>();
  for (const d of docs) {
    const list = bySource.get(str(d.source)) ?? [];
    if (list.length < perSource) list.push(d);
    bySource.set(str(d.source), list);
  }
  return [...bySource.entries()]
    .sort((a, b) => compareSourceLabel(a[0], b[0]))
    .flatMap(([, list]) => list)
    .map((d) => {
      const qd = (d.question_data && typeof d.question_data === 'object' ? d.question_data : {}) as Doc;
      return { doc: d, qd, source: str(d.source), answer: str(qd.CorrectAnswer).trim() };
    });
}

/* ─────────────── 정답열 ─────────────── */

export function isSingleAnswerSequence(seq: readonly string[]): boolean {
  return seq.length > 0 && seq.every((a) => CIRCLED_LIST.includes(a));
}

export function adjacentRepeats(seq: readonly string[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i += 1) if (seq[i] === seq[i - 1]) n += 1;
  return n;
}

export function sequenceSummary(seq: readonly string[]): string {
  const dist = CIRCLED.map((c) => `${c}${seq.filter((x) => x === c).length}`).join(' ');
  return `[${dist}] 연속 ${adjacentRepeats(seq)}쌍`;
}

export function describeSequence(seq: readonly string[]): string {
  return `${seq.join('')}  ${sequenceSummary(seq)}`;
}

const FINAL_CONSONANT: Record<string, boolean> = { '①': true, '②': false, '③': true, '④': false, '⑤': false };
const PARTICLE_PAIRS: Record<string, [string, string]> = {
  이: ['이', '가'],
  가: ['이', '가'],
  은: ['은', '는'],
  는: ['은', '는'],
  을: ['을', '를'],
  를: ['을', '를'],
  과: ['과', '와'],
  와: ['과', '와'],
};

/**
 * 번호 뒤 조사를 번호 읽기에 맞춘다 — ①이(일) ②가(이) ③이(삼) ④가(사) ⑤가(오).
 * 「이/가」는 「정답」 앞일 때만 고친다(지시어 '이'와 구분).
 */
export function fixCircledParticles(s: string): string {
  return s.replace(
    /([①②③④⑤])(\s?)(이|가)(?=\s정답)|([①②③④⑤])(\s?)(은|는|을|를|과|와)(?=[\s.,)]|$)/g,
    (match: string, c1?: string, sp1?: string, p1?: string, c2?: string, sp2?: string, p2?: string) => {
      const c = c1 ?? c2;
      const pair = PARTICLE_PAIRS[p1 ?? p2 ?? ''];
      if (!c || !pair) return match;
      return `${c}${(c1 ? sp1 : sp2) ?? ''}${FINAL_CONSONANT[c] ? pair[0] : pair[1]}`;
    },
  );
}

/** 옮겨 갈 수 있는 번호 → 비용. 비어 있으면 그 문항은 옮기지 않는다. */
export type TargetCosts = ReadonlyMap<string, number>;
export const ANY_TARGET: TargetCosts = new Map(CIRCLED.map((c): [string, number] => [c, 0]));
export const NO_TARGET: TargetCosts = new Map();

/**
 * 이웃 중복·xyxy 반복을 없애는 정답열 계획 — 열 전체를 한 번에 본다(동적 계획법).
 * 비용: 이웃 같은 번호 1000 · xyxy 10 · 옮김 1 + 옮김 비용(targetsOf) · 두 칸 떨어진 같은 번호 0.5 · 많이 쓰인 번호 0.01×개수.
 * 그래서 이웃 중복(선생님이 지적한 패턴)을 무엇보다 먼저 없애고, 그다음 xyxy, 그중 옮기는 문항이 가장 적은 안을 고른다.
 * 옮길 수 있는 번호가 ①②뿐인 문항이 이어지면 xyxy 는 남을 수 있다. 한 문항씩 차례로 고치면
 * 앞에서 한 선택이 뒤 문항의 길을 막는 경우가 있어(삽입처럼 옮길 수 있는 번호가 제한될 때) 전체를 본다.
 * 옮길 수 없는 문항(빈 targets)은 그대로 둔다.
 * balanceCap 을 주면 한 번호가 그 수를 넘지 않게 더 옮긴다 — 아무 번호로나 옮길 수 있는 셔플형 용.
 */
export function planAnswerSequence(
  seq: readonly string[],
  targetsOf: (i: number) => TargetCosts,
  balanceCap?: number,
): string[] {
  const n = seq.length;
  if (!n) return [];
  const used = new Map<string, number>();
  for (const v of seq) used.set(v, (used.get(v) ?? 0) + 1);
  const choices = (i: number): [string, number][] => {
    const m = new Map<string, number>([[seq[i], 0]]);
    for (const [v, c] of targetsOf(i)) if (v !== seq[i]) m.set(v, 1 + c + 0.01 * (used.get(v) ?? 0));
    return [...m];
  };
  /* 상태 = 직전 세 문항의 번호 「p|q|r」(번호에 '|' 가 없어 키로 안전). */
  interface Step {
    cost: number;
    prev: string | null;
    value: string;
  }
  const layers: Map<string, Step>[] = [];
  let layer = new Map<string, Step>();
  for (const [v, c] of choices(0)) layer.set(`||${v}`, { cost: c, prev: null, value: v });
  layers.push(layer);
  for (let i = 1; i < n; i += 1) {
    const next = new Map<string, Step>();
    const options = choices(i);
    for (const [key, step] of layer) {
      const [p, q, r] = key.split('|');
      for (const [s, c] of options) {
        let cost = step.cost + c;
        if (s === r) cost += 1000;
        if (p && p === r && q === s) cost += 10;
        if (q && q === s) cost += 0.5;
        const nk = `${q}|${r}|${s}`;
        const cur = next.get(nk);
        if (!cur || cost < cur.cost) next.set(nk, { cost, prev: key, value: s });
      }
    }
    layer = next;
    layers.push(layer);
  }
  let key: string | null = null;
  let bestCost = Infinity;
  for (const [k, step] of layer) {
    if (step.cost < bestCost) {
      bestCost = step.cost;
      key = k;
    }
  }
  const out: string[] = [...seq];
  for (let i = n - 1; i >= 0 && key !== null; i -= 1) {
    const step: Step | undefined = layers[i].get(key);
    if (!step) break;
    out[i] = step.value;
    key = step.prev;
  }
  const count = (v: string) => out.filter((x) => x === v).length;
  if (balanceCap !== undefined) {
    for (let guard = 0; guard < out.length; guard += 1) {
      const over = CIRCLED.filter((c) => count(c) > balanceCap).sort((a, b) => count(b) - count(a))[0];
      if (!over) break;
      let shifted = false;
      for (let i = 0; i < out.length && !shifted; i += 1) {
        if (out[i] !== over) continue;
        const near = [out[i - 1], out[i + 1], out[i - 2], out[i + 2]];
        const cands = [...targetsOf(i).keys()]
          .filter((c) => c !== over && !near.includes(c) && count(c) < balanceCap)
          .sort((a, b) => count(a) - count(b));
        if (cands.length) {
          out[i] = cands[0];
          shifted = true;
        }
      }
      if (!shifted) break;
    }
  }
  return out;
}

/** 셔플형 쏠림 상한 — 평균 + 1(20문항 이상은 + 2). */
export function balanceCapFor(n: number): number {
  return Math.ceil(n / 5) + (n >= 20 ? 2 : 1);
}

/* ─────────────── 순서: (A)(B)(C) 라벨 치환 ─────────────── */

const ORDER_PERM: Record<string, string> = { '①': 'ACB', '②': 'BAC', '③': 'BCA', '④': 'CAB', '⑤': 'CBA' };
const ORDER_ANSWER: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_PERM).map(([a, p]) => [p, a]),
);

function orderReadingKey(paragraph: string, original: string): { key: string | null; parts: OrderParagraphParts | null } {
  const parts = parseOrderParagraph(paragraph);
  if (!parts || !original) return { key: null, parts };
  const key = computeReadingOrderKey({
    A: findPositionInOriginal(original, parts.A),
    B: findPositionInOriginal(original, parts.B),
    C: findPositionInOriginal(original, parts.C),
  });
  return { key, parts };
}

/** 본문 덩이의 원문 위치로 구한 정답. 저장된 CorrectAnswer 와 다르면 문항 자체가 틀린 것이라 교정 대상에서 뺀다. */
export function orderAnswerFromText(paragraph: string, original: string): string | null {
  const { key } = orderReadingKey(paragraph, original);
  return key ? ORDER_ANSWER[key] ?? null : null;
}

const ORDER_EXPLANATION_RE =
  /([①②③④⑤])?(\s?)\(([ABC])\)(\s*[-–—→]\s*)\(([ABC])\)(\s*[-–—→]\s*)\(([ABC])\)|\(([ABC])\)|([①②③④⑤])/g;

export interface OrderRelabel {
  paragraph: string;
  explanation: string;
  /** 해설에서 자동 치환이 애매한 곳 — 있으면 적용하지 말고 사람이 본다 */
  flags: string[];
  verified: boolean;
}

/**
 * 순서 문항의 정답을 target 으로 옮긴다. 원문 연속 세 덩이(c1,c2,c3)의 라벨만 바꾸고
 * 해설의 (A)(B)(C)·보기 인용·정답 번호를 같은 규칙으로 치환한다. 원문 대조로 검증.
 */
export function relabelOrderQuestion(qd: Doc, original: string, target: string): OrderRelabel | null {
  const paragraph = str(qd.Paragraph);
  const oldAnswer = str(qd.CorrectAnswer).trim();
  const { key: sigma, parts } = orderReadingKey(paragraph, original);
  const tau = ORDER_PERM[target];
  if (!sigma || !parts || !tau || ORDER_ANSWER[sigma] !== oldAnswer) return null;
  const labelMap: Record<string, string> = {};
  const textOf: Record<string, string> = {};
  for (let k = 0; k < 3; k += 1) {
    labelMap[sigma[k]] = tau[k];
    textOf[tau[k]] = parts[sigma[k] as 'A' | 'B' | 'C'];
  }
  const sep = /\n###\n\(A\)/.test(paragraph) ? '\n###\n' : '\n\n';
  const nextParagraph = [parts.intro, `(A) ${textOf.A}`, `(B) ${textOf.B}`, `(C) ${textOf.C}`].join(sep);
  const flags: string[] = [];
  const mapped = str(qd.Explanation).replace(
    ORDER_EXPLANATION_RE,
    (
      match: string,
      circ?: string,
      sp?: string,
      x?: string,
      s1?: string,
      y?: string,
      s2?: string,
      z?: string,
      single?: string,
      bare?: string,
    ) => {
      if (x && y && z) {
        const p = labelMap[x] + labelMap[y] + labelMap[z];
        const perm = `(${p[0]})${s1 ?? ''}(${p[1]})${s2 ?? ''}(${p[2]})`;
        if (!circ) return `${sp ?? ''}${perm}`;
        const n = ORDER_ANSWER[p];
        if (!n) {
          flags.push(`보기 인용 「${match.trim()}」 → ${p}(선택지에 없는 순열)`);
          return `${sp ?? ''}${perm}`;
        }
        return `${n}${sp ?? ''}${perm}`;
      }
      if (single) return `(${labelMap[single]})`;
      if (bare) {
        if (bare === oldAnswer) return target;
        flags.push(`단독 번호 ${bare}`);
        return bare;
      }
      return match;
    },
  );
  if (/(^|[^A-Za-z(])[ABC](?=\s*(단락|문단|는|은|가|이|의|에|로|와|과|를|을|[-–→]))/.test(mapped)) {
    flags.push('괄호 없는 라벨 표기 의심');
  }
  const check = orderReadingKey(nextParagraph, original);
  const verified = check.key === tau && correctAnswerFromOwnOptions(qd.Options, readingKeyToPerm(tau)) === target;
  return { paragraph: nextParagraph, explanation: fixCircledParticles(mapped), flags, verified };
}

/* ─────────────── 삽입: 마커 자리 이동 ─────────────── */

export interface InsertionLayout {
  given: string;
  sep: string;
  /** 마커 표기 — 「①」 그대로인지 「( ① )」처럼 괄호로 감쌌는지. 다시 찍을 때 같은 모양을 쓴다. */
  markerOpen: string;
  markerClose: string;
  /** 마커를 걷어 낸 본문 */
  body: string;
  /** 현재 ①~⑤ 마커 자리(body 오프셋) */
  marks: number[];
  /** 마커를 둘 수 있는 자리 — 문장 경계(지문 sentences_en 기준) + 맨앞·맨뒤 */
  gaps: number[];
}

function stripInsertionMarkers(raw: string): { body: string; marks: number[] } {
  let out = '';
  const marks: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (CIRCLED_LIST.includes(raw[i])) {
      out = out.replace(/[ \t]+$/, '');
      if (out.length && !out.endsWith('\n')) out += ' ';
      marks.push(out.length);
      i += 1;
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i += 1;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  const body = out.replace(/\s+$/, '');
  return { body, marks: marks.map((m) => Math.min(m, body.length)) };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function sentenceStartsFromPassage(body: string, sentences: string[], given: string): number[] | null {
  const starts: number[] = [];
  let cursor = 0;
  for (const s of sentences) {
    const ns = squash(s);
    if (!ns || ns === squash(given)) continue;
    const re = new RegExp(escapeRegExp(ns.slice(0, 30)).replace(/ /g, '\\s+'), 'g');
    re.lastIndex = cursor;
    const m = re.exec(body);
    if (!m) return null;
    starts.push(m.index);
    cursor = m.index + 1;
  }
  return starts;
}

function sentenceStartsByPunctuation(body: string): number[] {
  const starts = [0];
  const re = /([.!?]["”’)\]]?)(\s+)(?=["“‘(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const end = m.index + m[1].length;
    const prev = body.slice(Math.max(0, end - 6), end);
    if (/\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|No)\.$/.test(prev) || /\b[A-Z]\.$/.test(prev)) continue;
    starts.push(end + m[2].length);
  }
  return starts;
}

export function parseInsertionParagraph(paragraph: string, sentences: string[]): InsertionLayout | null {
  const sep = paragraph.includes('\n###\n') ? '\n###\n' : '\n\n';
  const at = paragraph.indexOf(sep);
  if (at < 0) return null;
  const given = paragraph.slice(0, at);
  const raw = paragraph.slice(at + sep.length).replace(/^\s+/, '');
  /* 「( ① )」 괄호 표기 — 괄호째 걷어 내야 빈 「( )」가 본문에 남지 않는다. 모양은 기억했다가 그대로 다시 찍는다. */
  const paren = raw.match(/\(([ \t]*)[①②③④⑤]([ \t]*)\)/);
  const markerOpen = paren ? `(${paren[1]}` : '';
  const markerClose = paren ? `${paren[2]})` : '';
  const bare = paren ? raw.replace(/\([ \t]*([①②③④⑤])[ \t]*\)/g, '$1') : raw;
  const { body, marks } = stripInsertionMarkers(bare);
  if (marks.length !== 5) return null;
  const starts = sentenceStartsFromPassage(body, sentences, given) ?? sentenceStartsByPunctuation(body);
  const gaps = [...new Set([0, ...starts, ...marks, body.length])].sort((a, b) => a - b);
  return { given, sep, markerOpen, markerClose, body, marks, gaps };
}

function renderInsertionParagraph(layout: InsertionLayout, markers: number[]): string {
  const asc = [...markers].sort((a, b) => a - b);
  let body = layout.body;
  for (const o of [...asc].reverse()) {
    const mk = `${layout.markerOpen}${CIRCLED[asc.indexOf(o)]}${layout.markerClose}`;
    body = o >= body.length ? `${body} ${mk}` : `${body.slice(0, o)}${mk} ${body.slice(o)}`;
  }
  return `${layout.given}${layout.sep}${body}`;
}

export interface InsertionOption {
  markers: number[];
  cost: number;
  /** 해설이 번호로 언급한 자리가 없어진다 — 해설을 손으로 고쳐야 쓸 수 있다(relaxed 에서만 나옴) */
  needsExplanationEdit: boolean;
}

/**
 * 정답 자리(correctGap)를 v번째 마커로 만드는 마커 집합들.
 * 기존 마커를 최대한 살리고, 새 자리는 정답 바로 옆 경계(모호해질 수 있음)·글 끝 순으로 미룬다.
 * 맨앞 자리는 새로 만들지 않는다(relaxed 에서만 허용). 원래 정답 앞(뒤)에 있던 마커를 모두 없애는 안은 비싸게.
 */
export function insertionMarkerOptions(
  layout: InsertionLayout,
  correctGap: number,
  explanation: string,
  relaxed = false,
): Map<string, InsertionOption> {
  const refs = new Set([...explanation].map((c) => CIRCLED_LIST.indexOf(c)).filter((x) => x >= 0));
  const gi = layout.gaps.indexOf(correctGap);
  const current = layout.marks.indexOf(correctGap);
  const kept = new Set(layout.marks);
  const front = layout.gaps[0];
  const end = layout.body.length;
  const adjacent = new Set([layout.gaps[gi - 1], layout.gaps[gi + 1]]);
  const addCost = (o: number) => (o === front ? 10 : o === end ? 1.5 : adjacent.has(o) ? 2.5 : 1);
  const usable = (arr: number[]) => (relaxed ? arr : arr.filter((o) => o !== front || kept.has(o)));
  const pick = (pool: number[], n: number): number[] | null => {
    if (pool.length < n) return null;
    return pool
      .map((o) => ({ o, s: kept.has(o) ? 0 : addCost(o), d: Math.abs(layout.gaps.indexOf(o) - gi) }))
      .sort((a, b) => a.s - b.s || a.d - b.d)
      .slice(0, n)
      .map((x) => x.o);
  };
  const out = new Map<string, InsertionOption>();
  if (gi < 0 || current < 0) return out;
  for (let v = 1; v <= 5; v += 1) {
    if (v === current + 1) continue;
    const before = pick(usable(layout.gaps.slice(0, gi)), v - 1);
    const after = pick(usable(layout.gaps.slice(gi + 1)), 5 - v);
    if (!before || !after) continue;
    const markers = [...before, correctGap, ...after].sort((a, b) => a - b);
    const dropped = layout.marks.filter((o) => !markers.includes(o));
    const needsExplanationEdit = dropped.some((o) => refs.has(layout.marks.indexOf(o)));
    if (needsExplanationEdit && !relaxed) continue;
    let cost = needsExplanationEdit ? 3 : 0;
    for (const o of markers) if (!kept.has(o)) cost += addCost(o);
    const hadBefore = layout.marks.some((o) => o < correctGap);
    const hadAfter = layout.marks.some((o) => o > correctGap);
    if ((hadBefore && !markers.some((o) => o < correctGap)) || (hadAfter && !markers.some((o) => o > correctGap))) {
      cost += 2;
    }
    out.set(CIRCLED[v - 1], { markers, cost, needsExplanationEdit });
  }
  return out;
}

export interface InsertionRewrite {
  paragraph: string;
  explanation: string;
  answer: string;
  flags: string[];
  verified: boolean;
}

/** 마커를 markers 자리로 다시 찍고 해설의 번호를 자리 기준으로 옮긴다. 본문 글자·주어진 문장이 그대로인지 검증. */
export function rewriteInsertionQuestion(
  qd: Doc,
  layout: InsertionLayout,
  sentences: string[],
  correctGap: number,
  markers: number[],
): InsertionRewrite {
  const asc = [...markers].sort((a, b) => a - b);
  const paragraph = renderInsertionParagraph(layout, asc);
  const flags: string[] = [];
  const mapped = str(qd.Explanation).replace(/[①②③④⑤]/g, (c: string) => {
    const ni = asc.indexOf(layout.marks[CIRCLED_LIST.indexOf(c)]);
    if (ni < 0) {
      flags.push(`해설이 없어진 자리 ${c} 를 언급`);
      return c;
    }
    return CIRCLED[ni];
  });
  const answer = asc.includes(correctGap) ? CIRCLED[asc.indexOf(correctGap)] : '';
  const again = parseInsertionParagraph(paragraph, sentences);
  const bodyMarks = (paragraph.slice(paragraph.indexOf(layout.sep) + layout.sep.length).match(/[①②③④⑤]/g) ?? []).join('');
  const verified =
    !!again && again.body === layout.body && again.given === layout.given && bodyMarks === '①②③④⑤' && !!answer;
  return { paragraph, explanation: fixCircledParticles(mapped), answer, flags, verified };
}

/** 마커 자리를 앞뒤 문맥으로 보여 준다(dry-run 검토용). */
export function describeInsertionMarkers(layout: InsertionLayout, markers: number[]): string {
  const asc = [...markers].sort((a, b) => a - b);
  return asc
    .map((o, k) => `${CIRCLED[k]}「…${layout.body.slice(Math.max(0, o - 22), o).trim()} ▌ ${layout.body.slice(o, o + 22).trim()}…」`)
    .join(' ');
}

/* ─────────────── 셔플형: 두 보기 맞바꿈 ─────────────── */

export interface ShuffledSwap {
  options: string;
  correctAnswer: string;
  explanation: string;
  verified: boolean;
}

/** 정답 보기와 target 자리 보기 두 개만 맞바꾼다(해설의 두 번호도 맞바꾸고 조사 맞춤). 보기 5개·단일 정답만. */
export function swapShuffledAnswer(qd: Doc, target: string): ShuffledSwap | null {
  if (typeof qd.Options !== 'string') return null;
  const parts = qd.Options.split(/\s*###\s*/).map((s) => s.trim());
  if (parts.length !== 5) return null;
  const texts = parts.map((s) => s.replace(/^[①②③④⑤]\s*/, '').trim());
  const a = CIRCLED_LIST.indexOf(str(qd.CorrectAnswer).trim());
  const b = CIRCLED_LIST.indexOf(target);
  if (a < 0 || b < 0 || texts.some((s) => !s)) return null;
  const next = [...texts];
  [next[a], next[b]] = [next[b], next[a]];
  const hold = ['\u0000α', '\u0000β'];
  const explanation = fixCircledParticles(
    str(qd.Explanation)
      .split(CIRCLED[a]).join(hold[0])
      .split(CIRCLED[b]).join(hold[1])
      .split(hold[0]).join(CIRCLED[b])
      .split(hold[1]).join(CIRCLED[a]),
  );
  const verified =
    next[b] === texts[a] && [...next].sort().join('\u0001') === [...texts].sort().join('\u0001');
  return {
    options: next.map((s, i) => `${CIRCLED[i]} ${s}`).join(' ### '),
    correctAnswer: target,
    explanation,
    verified,
  };
}

/* ─────────────── 백업·초안 파일 ─────────────── */

function writeJson(dir: string, name: string, data: unknown): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return file;
}

/** 패치 전 원본 — .variant-drafts/backups/ (gitignore) */
export function writeVariantBackup(name: string, data: unknown): string {
  return writeJson(path.join(process.cwd(), '.variant-drafts', 'backups'), name, data);
}

/** prevalidate·수기 수정용 초안 — .variant-drafts/answer-seq/ (gitignore) */
export function writeVariantDraft(name: string, data: unknown): string {
  return writeJson(path.join(process.cwd(), '.variant-drafts', 'answer-seq'), name, data);
}
