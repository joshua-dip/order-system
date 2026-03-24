/** 큰따옴표/작은따옴표 스마트 부호 → ASCII (JSON 호환) */
function normalizeSmartQuotes(s: string): string {
  return s
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'");
}

/**
 * 문자열 리터럴을 고려해 첫 번째 최상위 `{ ... }` 구간만 잘라냄.
 * (기존 first `{` ~ last `}` 는 문자열 안의 `}` 나 뒤에 붙은 잡담에 깨지기 쉬움)
 */
export function sliceBalancedJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
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

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const balanced = sliceBalancedJsonObject(raw);
  const candidates: string[] = [];
  if (balanced) candidates.push(balanced);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const legacy = raw.slice(start, end + 1);
    if (!candidates.includes(legacy)) candidates.push(legacy);
  }
  for (const slice of candidates) {
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

/** LLM 응답에서 첫 JSON 객체 추출 (코드펜스·앞뒤 잡담 허용, 중괄호 균형 매칭) */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const rawFromFence = fence ? fence[1].trim() : '';
  const sources = rawFromFence ? [normalizeSmartQuotes(rawFromFence), rawFromFence] : [normalizeSmartQuotes(t), t];

  for (const raw of sources) {
    const parsed = tryParseJsonObject(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return null;
}
