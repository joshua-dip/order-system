/**
 * 국어 해설지 *_html 필드 sanitize — 화이트리스트 방식.
 *
 * 허용:
 *   - 태그: span, strong, em, u, b, i, br, mark
 *   - span 의 class 속성: hl-key | hl-term | hl-cause | hl-effect (단일 값만)
 *   - 그 외 속성·태그는 제거
 *   - HTML 엔티티 정상 통과 (&lt; &gt; &amp; &quot; 등)
 *
 * admin 입력 신뢰 가정 하에 가벼운 1단계 sanitize. 학생 노출 시점에는
 * 별도 sanitize 가 또 필요 (본 PLAN 범위 밖).
 */

const ALLOWED_TAGS = new Set(['span', 'strong', 'em', 'u', 'b', 'i', 'br', 'mark']);
const ALLOWED_HL_CLASSES = new Set(['hl-key', 'hl-term', 'hl-cause', 'hl-effect']);

/**
 * 단순 정규식 기반. DOMParser/JSDOM 없이 동작해야 서버 렌더에서도 쓸 수 있음.
 *
 *   <tag attr="...">     → 허용 태그면 attr 필터, 아니면 통째 제거
 *   </tag>               → 허용 태그면 통과, 아니면 제거
 *   <!-- ... -->         → 제거
 *   <script>...</script> → 통째 제거
 */
export function sanitizeInlineHtml(input: string): string {
  if (!input) return '';

  let out = input;

  // 1) script/style 통째 제거
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 2) HTML 주석 제거
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // 3) 모든 태그를 순회하며 화이트리스트 필터
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (match, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';

    const isClosing = match.startsWith('</');
    if (isClosing) return `</${tag}>`;

    // 자기 닫기 br
    if (tag === 'br') return '<br />';

    // span 의 class 만 허용. 그 외 태그는 속성 없이.
    if (tag === 'span') {
      const cls = extractHighlightClass(rawAttrs);
      return cls ? `<span class="${cls}">` : '<span>';
    }

    return `<${tag}>`;
  });

  return out;
}

function extractHighlightClass(rawAttrs: string): string | null {
  const m = rawAttrs.match(/class\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
  if (!m) return null;
  const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  if (!value) return null;
  const tokens = value.split(/\s+/);
  const allowed = tokens.find(t => ALLOWED_HL_CLASSES.has(t));
  return allowed ?? null;
}

/** 텍스트(엔티티 제외)를 HTML 안전 문자열로 이스케이프. label/title 등 본문 평문에 사용. */
export function escapeText(input: string): string {
  return input.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
