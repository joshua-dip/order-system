/**
 * 사용 기록용 행동 이벤트(클라이언트). 실패해도 화면에는 영향이 없다.
 * 새 탭으로 나가는 링크 클릭도 놓치지 않게 sendBeacon 을 먼저 쓴다.
 *
 *   trackEvent('order_create', { flow: 'bookVariant', questions: 54 })
 */
export function trackEvent(name: string, props?: Record<string, string | number | boolean | null | undefined>): void {
  if (typeof window === 'undefined') return;
  try {
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(props ?? {})) if (v != null) clean[k] = v;
    const body = JSON.stringify({ name, path: window.location.pathname, props: clean });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/public/track-event', new Blob([body], { type: 'text/plain' }))) return;
    void fetch('/api/public/track-event', { method: 'POST', body, credentials: 'include', keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
}
