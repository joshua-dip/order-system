/**
 * 주문서를 API를 통해 MongoDB(gomijoshua DB)에 저장합니다.
 * orderPrefix: 주문번호 접두어 2글자 (재료+제품, 예: MV=모의고사+변형, BV=부교재+변형, MW=모의고사+워크북). 생략 시 GJ.
 */
export async function saveOrderToDb(
  orderText: string,
  orderPrefix?: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderText, ...(orderPrefix && { orderPrefix }) }),
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
