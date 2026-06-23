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

/**
 * 외부 노출/미리보기용: 구분자 `###` 를 사람이 읽을 수 있는 형태로 정리.
 * (`###` 는 내부 보기·블록 구분자이므로, 출력 시 그대로 노출되면 안 됨)
 */
export function stripOptionDelimiters(text: string): string {
  return (text ?? '').replace(/\s*###\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 외부 공개 API용: question_data 의 `###` 구분자를 정규화.
 *  · Options: `###` → 보기 배열(`options`) + 줄바꿈 문자열로 변환
 *  · Paragraph: 블록 구분 `###` → 빈 줄
 * 원본 객체는 변형하지 않고 사본을 반환.
 */
export function sanitizeQuestionDataForExport(qd: unknown): Record<string, unknown> | null {
  if (!qd || typeof qd !== 'object') return (qd as Record<string, unknown>) ?? null;
  const out: Record<string, unknown> = { ...(qd as Record<string, unknown>) };

  const rawOptions = typeof out.Options === 'string' ? (out.Options as string) : '';
  if (rawOptions.includes('###')) {
    const segs = splitQuestionOptionSegments(rawOptions);
    if (segs.length > 0) out.options = segs;
    out.Options = segs.join('\n');
  }

  if (typeof out.Paragraph === 'string') {
    out.Paragraph = (out.Paragraph as string)
      .replace(/\n?[ \t]*###[ \t]*\n?/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return out;
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
