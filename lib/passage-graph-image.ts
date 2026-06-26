/**
 * 지문(도표) 그래프 이미지 — base64 data URI 검증/정규화.
 * 25번 도표처럼 그래프가 있어야 풀 수 있는 지문에 이미지를 붙여,
 * 문제지 PDF 렌더 시 본문 위에 인쇄한다. (passages.graphImage 에 data URI 로 저장)
 *
 * Lambda Chromium 은 외부 URL 을 못 불러오므로 한글 폰트(lib/pdf-korean-font.ts)와
 * 동일하게 base64 data URI 만 사용한다.
 */

/** base64 문자열 길이 상한(원본 약 3MB). BSON 16MB 한계 대비 넉넉. */
export const PASSAGE_GRAPH_IMAGE_MAX_LEN = 4_000_000;

export type GraphImageParse =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * 요청 body 의 graphImage 값을 검증한다.
 * - null / 빈 문자열 → null (이미지 제거)
 * - 유효한 data:image/* base64 → 그대로
 * - 그 외 → 오류
 * (undefined 는 "변경 없음" 이므로 호출부에서 분기할 것 — 이 함수에 넘기지 말 것)
 */
export function parseGraphImageInput(raw: unknown): GraphImageParse {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: '그래프 이미지 형식이 올바르지 않습니다.' };
  }
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) {
    return { ok: false, error: '그래프 이미지는 PNG·JPG·GIF·WEBP base64 data URI여야 합니다.' };
  }
  if (v.length > PASSAGE_GRAPH_IMAGE_MAX_LEN) {
    return { ok: false, error: '그래프 이미지가 너무 큽니다(최대 약 3MB). 압축 후 다시 올려 주세요.' };
  }
  return { ok: true, value: v };
}
