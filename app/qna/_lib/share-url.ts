/**
 * 페이지/문장/thread 3-레벨 링크 복사·공유 단일 헬퍼.
 *
 * - `navigator.share` 가능 시 OS 공유 시트(카톡·메시지) 호출 → 토스트는 시트가 대신함 ('shared').
 * - 비지원/실패 시 `navigator.clipboard.writeText` fallback → 'copied' 반환.
 * - 둘 다 실패하면 'failed'.
 *
 * 호출 측은 반환값을 보고 토스트 문구 분기 (공유 성공은 일반적으로 토스트 생략).
 */

export type ShareOutcome = 'shared' | 'copied' | 'failed';

export async function copyShareUrl(
  url: string,
  opts: { title?: string; text?: string; preferShare?: boolean } = {},
): Promise<ShareOutcome> {
  const { title, text, preferShare = true } = opts;

  if (preferShare && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title, text });
      return 'shared';
    } catch (err) {
      // AbortError = 사용자가 시트 닫음. fallback 하지 말고 그냥 끝.
      if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
        return 'shared';
      }
      // 다른 에러는 clipboard fallback 시도
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      /* fallthrough */
    }
  }

  // 마지막 fallback: 임시 textarea
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return 'copied';
    } catch {
      /* fallthrough */
    }
  }

  return 'failed';
}

/** 일반 문자열 복사(공유 시트 무시). 단어/문장 복사용. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallthrough */
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}
