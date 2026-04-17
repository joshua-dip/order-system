/**
 * 회원 본인 Anthropic API 키 — 브라우저 localStorage 전용.
 * 서버로 전송·저장하지 않으며, 로그인 ID별로 분리합니다.
 * 비로그인 방문자는 GUEST_BYOK_ID 키로 저장됩니다.
 */
const STORAGE_PREFIX = 'next-order:byok-anthropic-api-key:';

/** 비로그인 방문자용 localStorage 키 식별자 */
export const GUEST_BYOK_ID = '__guest__';

/** loginId가 비어 있으면 게스트 키를 사용합니다. */
function resolveId(loginId: string): string {
  return loginId.trim() || GUEST_BYOK_ID;
}

export function byokAnthropicStorageKey(loginId: string): string {
  return `${STORAGE_PREFIX}${resolveId(loginId)}`;
}

export function readStoredByokAnthropicKey(loginId: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(byokAnthropicStorageKey(loginId))?.trim() ?? '';
}

export function writeStoredByokAnthropicKey(loginId: string, apiKey: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = apiKey.trim();
  if (!trimmed) {
    window.localStorage.removeItem(byokAnthropicStorageKey(loginId));
  } else {
    window.localStorage.setItem(byokAnthropicStorageKey(loginId), trimmed);
  }
}

export function hasStoredByokAnthropicKey(loginId: string): boolean {
  return readStoredByokAnthropicKey(loginId).length > 0;
}
