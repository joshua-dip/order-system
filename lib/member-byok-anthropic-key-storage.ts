/**
 * 회원 본인 Anthropic API 키 — 브라우저 localStorage 전용.
 * 서버로 전송·저장하지 않으며, 로그인 ID별로 분리합니다.
 */
const STORAGE_PREFIX = 'next-order:byok-anthropic-api-key:';

export function byokAnthropicStorageKey(loginId: string): string {
  return `${STORAGE_PREFIX}${loginId}`;
}

export function readStoredByokAnthropicKey(loginId: string): string {
  if (typeof window === 'undefined' || !loginId.trim()) return '';
  return window.localStorage.getItem(byokAnthropicStorageKey(loginId))?.trim() ?? '';
}

export function writeStoredByokAnthropicKey(loginId: string, apiKey: string): void {
  if (typeof window === 'undefined' || !loginId.trim()) return;
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
