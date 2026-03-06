/**
 * 주문서를 API를 통해 MongoDB(lyceum DB)에 저장합니다.
 * UI 블로킹 없이 호출해도 됩니다.
 */
export async function saveOrderToDb(orderText: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderText }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error || res.statusText };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}
