/**
 * next-order 저장분 → 분석지 조판 입력 (라우트·CLI 공용).
 *
 * 두 가지를 흡수한다.
 *  1. 단어 키 — 이쪽 분석기는 "si:wi", 조판기(리체움 이식본)는 "si-wi".
 *  2. 라벨 — 이쪽 source_key 는 "Lesson 2. The Global Reach … 본문1" 처럼
 *     챕터 서술이 통째로 들어 있어, 그대로 번호에 넣으면 목차에서 잘린다.
 *     선택 지문들이 공유하는 접두사를 강(chapter)으로 분리해 번호를 짧게 만든다.
 */
import type { SheetPassage } from './analysis-sheet-html';

/* ── svocData 정규화 ──────────────────────────────────────────────────────
 *
 * 저장 시대에 따라 svocData 모양이 세 갈래다 (2026-09-01 전수 조사):
 *   ① 객체 + 단어 인덱스        — 조판기가 기대하는 형태 (Lesson 2 수기 등)
 *   ② 객체 + **문자 오프셋**     — 26년 6월 고3 등 ("My name" 이 17~24 = 글자 위치)
 *   ③ **배열** + 텍스트만/-1     — 수능특강(인덱스 없음)·26년 3월 고1(-1 센티널)
 *
 * ②③은 조판기의 hit 검사(단어 인덱스 전제)에 안 걸려 SVOC 마커가 통째로
 * 사라진다. 텍스트 필드가 진실이므로 여기서 단어 인덱스를 다시 세운다.
 * 저장 인덱스는 실제 토큰과 맞는지 검증해 통과할 때만 쓴다 — 문자 오프셋이
 * 우연히 범위 안이면 엉뚱한 단어에 마커가 붙는 것이 '없음'보다 나쁘다.
 */

const normTok = (s: string) => s.toLowerCase().replace(/[.,;:!?"'’“”()\[\]{}]/g, '');
const normPhrase = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** tokens[start..end] 가 phrase 와 (구두점 무시) 일치하는가 */
function wordRangeMatches(tokens: string[], start: number, end: number, phrase: string): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end < start || end >= tokens.length) return false;
  const a = tokens.slice(start, end + 1).map(normTok).join(' ');
  const b = normPhrase(phrase).split(/\s+/).map(normTok).join(' ');
  return a === b && b.length > 0;
}

/** phrase 의 첫 등장 단어 범위. 못 찾으면 null. */
function findWordRange(tokens: string[], phrase: string): [number, number] | null {
  const want = normPhrase(phrase).split(/\s+/).map(normTok).filter(Boolean);
  if (!want.length) return null;
  for (let i = 0; i + want.length <= tokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < want.length; j += 1) {
      if (normTok(tokens[i + j]) !== want[j]) { ok = false; break; }
    }
    if (ok) return [i, i + want.length - 1];
  }
  return null;
}

/** 문자 오프셋 → 단어 인덱스 (start 가 그 단어 안에 떨어지면 그 단어) */
function charToWord(sentence: string, charPos: number): number | null {
  if (!Number.isInteger(charPos) || charPos < 0 || charPos > sentence.length) return null;
  let wi = 0;
  let inWord = false;
  for (let i = 0; i < Math.min(charPos + 1, sentence.length); i += 1) {
    const isSpace = /\s/.test(sentence[i]);
    if (!isSpace && !inWord) inWord = true;
    if (isSpace && inWord) { inWord = false; if (i <= charPos) wi += 1; }
  }
  return wi;
}

/** 역할 하나를 {텍스트, 저장 start/end} 에서 단어 범위로 확정 */
function resolveRole(
  sentence: string,
  tokens: string[],
  text: unknown,
  rawStart: unknown,
  rawEnd: unknown,
): [number, number] | null {
  const phrase = normPhrase(String(text ?? ''));
  if (!phrase) return null;
  const st = typeof rawStart === 'number' ? rawStart : null;
  const en = typeof rawEnd === 'number' ? rawEnd : null;
  /* 1. 저장값이 단어 인덱스로서 검증되면 그대로 */
  if (st != null && en != null && wordRangeMatches(tokens, st, en, phrase)) return [st, en];
  /* 2. 문자 오프셋으로 해석해 단어로 변환한 것이 검증되면 그것 */
  if (st != null && en != null) {
    const ws = charToWord(sentence, st);
    const we = charToWord(sentence, en);
    if (ws != null && we != null && wordRangeMatches(tokens, ws, we, phrase)) return [ws, we];
  }
  /* 3. 텍스트를 토큰에서 직접 찾는다 (첫 등장) */
  return findWordRange(tokens, phrase);
}

/** 어느 모양이 와도 조판기 형태(단어 인덱스 객체)로. 확정 못 한 역할은 뺀다. */
export function normalizeSvocEntry(
  sentence: string,
  raw: unknown,
): Record<string, unknown> | null {
  /* 배열이면 내용이 있는 첫 항목(주절) — 마커는 한 문장에 한 벌만 얹을 수 있다. */
  const entry = Array.isArray(raw)
    ? raw.find((e) => e && typeof e === 'object' &&
        ['subject', 'verb'].some((k) => normPhrase(String((e as Record<string, unknown>)[k] ?? ''))))
    : raw;
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const tokens = normPhrase(sentence).split(' ');
  const out: Record<string, unknown> = {};
  const put = (role: string) => {
    const r = resolveRole(sentence, tokens, e[role], e[`${role}Start`], e[`${role}End`]);
    if (!r) return;
    out[role] = e[role];
    out[`${role}Start`] = r[0];
    out[`${role}End`] = r[1];
  };
  for (const role of [
    'subject', 'verb', 'object', 'directObject', 'indirectObject',
    'complement', 'subjectComplement', 'objectComplement',
  ]) put(role);
  return Object.keys(out).length ? out : null;
}

function normalizeSvocData(
  sentences: string[],
  raw: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const si = Number(k);
    const sentence = sentences[si];
    if (!sentence) continue;
    const n = normalizeSvocEntry(sentence, v);
    if (n) out[k] = n;
  }
  return out;
}

/** 구문 괄호 — 범위가 토큰 밖이면 버린다. 여는 괄호만 찍히고 닫히지 않는 지면 방지. */
function sanePhrases(sentences: string[], raw: unknown): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const len = normPhrase(sentences[Number(k)] ?? '').split(' ').length;
    if (!Array.isArray(v)) continue;
    out[k] = v.filter((ph) => {
      const p = ph as { startIndex?: unknown; endIndex?: unknown };
      return typeof p.startIndex === 'number' && typeof p.endIndex === 'number' &&
        p.startIndex >= 0 && p.startIndex <= p.endIndex && p.endIndex < len;
    });
  }
  return out;
}

export function toSheetState(main: Record<string, any>): Record<string, any> {
  const conv = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).map((k) => String(k).replace(':', '-'));
  const sentences: string[] = Array.isArray(main.sentences) ? main.sentences : [];
  return {
    ...main,
    grammarSelectedWords: conv(main.grammarSelectedWords),
    contextSelectedWords: conv(main.contextSelectedWords),
    svocData: normalizeSvocData(sentences, main.svocData),
    syntaxPhrases: sanePhrases(sentences, main.syntaxPhrases),
  };
}

export interface SheetPassageSource {
  textbook: string;
  sourceKey: string;
  /** passages.page_label ?? page */
  pageLabel?: string;
  main: Record<string, any>;
}

/** 단어 경계 기준 공통 접두사. 전체가 접두사인 라벨이 있으면 한 단어 물려 준다. */
function commonTokenPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  const tokLists = labels.map((l) => l.split(/\s+/));
  const first = tokLists[0];
  let n = 0;
  while (
    n < first.length &&
    tokLists.every((t) => t.length > n && t[n] === first[n])
  ) n += 1;
  /* 남는 토큰이 없는 라벨이 생기면 마지막 토큰은 번호로 돌려준다. */
  while (n > 0 && tokLists.some((t) => t.length <= n)) n -= 1;
  return first.slice(0, n).join(' ');
}

export function buildSheetPassages(sources: SheetPassageSource[]): SheetPassage[] {
  const stripped = sources.map((s) => {
    let label = String(s.sourceKey ?? '').trim();
    const tb = String(s.textbook ?? '').trim();
    if (tb && label.startsWith(tb)) label = label.slice(tb.length).trim();
    return { ...s, label };
  });
  const chapter = commonTokenPrefix(stripped.map((s) => s.label));
  return stripped.map((s) => {
    const page = String(s.pageLabel ?? '').trim();
    return {
      교재명: s.textbook,
      강: chapter || undefined,
      번호: chapter ? s.label.slice(chapter.length).trim() : s.label,
      페이지: page ? (page.startsWith('p') ? page : `p${page}`) : undefined,
      state: toSheetState(s.main),
    };
  });
}
