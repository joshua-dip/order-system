import { jsonrepair } from 'jsonrepair';

/** 큰따옴표/작은따옴표 스마트 부호 → ASCII (JSON 호환) */
function normalizeSmartQuotes(s: string): string {
  return s
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'");
}

/**
 * `start` 위치의 `{`부터 균형 잡힌 `}`까지 (문자열·이스케이프 고려).
 */
export function sliceBalancedJsonObjectFrom(s: string, start: number): string | null {
  if (start < 0 || start >= s.length || s[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 문자열 리터럴을 고려해 첫 번째 최상위 `{ ... }` 구간만 잘라냄.
 */
export function sliceBalancedJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  return sliceBalancedJsonObjectFrom(s, start);
}

/** `,` 뒤 공백·`}`/`]` 만 오는 경우 해당 쉼표 제거 (문자열 리터럴 밖에서만) */
function stripTrailingCommasInJson(slice: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      out += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < slice.length && /\s/.test(slice[j])) j++;
      if (slice[j] === '}' || slice[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/** 변형문제 question_data 후보 점수 (여러 JSON이 파싱될 때 선택) */
function variantDraftJsonScore(o: Record<string, unknown>): number {
  let s = 0;
  if ('Paragraph' in o && typeof o.Paragraph === 'string' && o.Paragraph.trim()) s += 15;
  if ('Question' in o && typeof o.Question === 'string' && o.Question.trim()) s += 10;
  if ('Options' in o && typeof o.Options === 'string' && o.Options.trim()) s += 8;
  if ('CorrectAnswer' in o) s += 5;
  if ('NumQuestion' in o || '순서' in o) s += 5;
  if ('Explanation' in o) s += 2;
  return s;
}

function tryParseToRecord(slice: string): Record<string, unknown> | null {
  const trimmed = slice.trim();
  if (!trimmed.startsWith('{')) return null;

  const bases = [trimmed, normalizeSmartQuotes(trimmed)];
  const toTry = new Set<string>();
  for (const b of bases) {
    toTry.add(b);
    const tc = stripTrailingCommasInJson(b);
    if (tc !== b) toTry.add(tc);
  }

  for (const s of toTry) {
    try {
      const o = JSON.parse(s) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* 다음 */
    }
  }

  for (const s of bases) {
    try {
      const fixed = jsonrepair(s);
      const o = JSON.parse(fixed) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }

  return null;
}

/** ``` 로 분리해 각 펜스 본문 수집 (첫 줄 언어 태그 제거) */
function collectMarkdownFenceBodies(text: string): string[] {
  const parts = text.split('```');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    let block = parts[i].replace(/^\r?\n?/, '');
    block = block.replace(/^[a-zA-Z][a-zA-Z0-9_-]*\s*\r?\n?/, '').trim();
    if (block) out.push(block);
  }
  return out;
}

function collectCandidateJsonSlices(text: string): string[] {
  const t = text.trim().replace(/^\uFEFF/, '');
  const n = normalizeSmartQuotes(t);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (x: string) => {
    const s = x.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const fences = collectMarkdownFenceBodies(t).sort((a, b) => b.length - a.length);
  for (const body of fences) {
    push(body);
    push(normalizeSmartQuotes(body));
  }

  push(n);
  push(t);

  for (let i = 0; i < n.length; i++) {
    if (n[i] === '{') {
      const sl = sliceBalancedJsonObjectFrom(n, i);
      if (sl) push(sl);
    }
  }

  const legacyStart = n.indexOf('{');
  const legacyEnd = n.lastIndexOf('}');
  if (legacyStart >= 0 && legacyEnd > legacyStart) {
    push(n.slice(legacyStart, legacyEnd + 1));
  }

  return out;
}

/** LLM 응답에서 JSON 객체 추출 (펜스·다중 `{`·후행 쉼표·jsonrepair) */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const candidates = collectCandidateJsonSlices(text);

  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  let bestLen = 0;

  for (const slice of candidates) {
    const parsed = tryParseToRecord(slice);
    if (!parsed || Array.isArray(parsed)) continue;
    const sc = variantDraftJsonScore(parsed);
    const len = JSON.stringify(parsed).length;
    if (sc > bestScore || (sc === bestScore && len > bestLen)) {
      bestScore = sc;
      bestLen = len;
      best = parsed;
    }
  }

  return best;
}
