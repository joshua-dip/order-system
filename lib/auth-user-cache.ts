/**
 * 로그인 사용자 표시 캐시 (sessionStorage, 탭 단위).
 * 로그인 응답의 user 를 저장해 두면 마이페이지·앱바가 auth/me 왕복을 기다리지 않고
 * 즉시 렌더된다(stale-while-revalidate). auth/me 응답이 오면 갱신, 로그아웃·비로그인 확인 시 삭제.
 *
 * ⚠️ 표시용 데이터만 담는다(권한 판단은 항상 서버 API가 다시 검증).
 * ⚠️ useState 초기값으로 직접 읽지 말 것(SSR 하이드레이션 크래시) — mount useEffect 에서 복원.
 */
const KEY = 'no:authUser:v1';

export function getAuthUserCache<T = Record<string, unknown>>(): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T & { loginId?: unknown };
    return parsed && typeof parsed === 'object' && typeof parsed.loginId === 'string' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function setAuthUserCache(user: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    if (user && typeof user === 'object') sessionStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* 저장 불가(시크릿 모드 등)여도 동작에는 지장 없음 */
  }
}

export function clearAuthUserCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
