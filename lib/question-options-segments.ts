/**
 * 변형문 Options 필드: 보기 구분은 `###` 우선(신규 규칙), 없으면 줄바꿈(기존 DB 호환).
 */

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

/**
 * Options 문자열을 보기 단위로 분리.
 * - `###`가 포함되면 `###`로만 구분
 * - 없으면 줄바꿈으로 구분
 */
export function splitQuestionOptionSegments(options: string): string[] {
  const s = (options ?? '').trim();
  if (!s) return [];
  if (s.includes('###')) {
    return s
      .split('###')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function optionsLineForChoice(options: string, choice: number): string | null {
  if (choice < 1 || choice > 5) return null;
  const circled = CIRCLED[choice - 1];
  const segments = splitQuestionOptionSegments(options);
  for (const seg of segments) {
    if (seg.startsWith(circled)) return seg;
  }
  for (const seg of segments) {
    if (new RegExp(`^${choice}[\\).\\s]`).test(seg)) return seg;
  }
  return null;
}

export function extractOptionBody(line: string, choice: number): string | null {
  let t = line.trim();
  if (!t) return null;
  const circled = CIRCLED[choice - 1];
  if (t.startsWith(circled)) {
    t = t.slice(circled.length).trim();
  } else {
    t = t.replace(new RegExp(`^${choice}\\s*[\\).:．]\\s*`), '').trim();
  }
  t = t.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  return t || null;
}
