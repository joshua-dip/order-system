import { getTossPaymentsSecretKey, tossWidgetSecretRejectionMessage } from '@/lib/toss-payments-env';

/**
 * 토스페이먼츠 결제 승인 (서버 전용). 시크릿 키는 클라이언트에 노출하지 마세요.
 * @see https://docs.tosspayments.com/reference#confirm-payment
 */
export async function tossConfirmPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<{ ok: true; raw: unknown } | { ok: false; message: string; status: number }> {
  const secret = getTossPaymentsSecretKey();
  if (!secret) {
    return { ok: false, message: '결제 서버 설정이 없습니다.', status: 503 };
  }
  const wSecret = tossWidgetSecretRejectionMessage(secret);
  if (wSecret) {
    return { ok: false, message: wSecret, status: 400 };
  }
  const auth = Buffer.from(`${secret}:`).toString('base64');
  const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paymentKey: params.paymentKey,
      orderId: params.orderId,
      amount: params.amount,
    }),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (raw as { message?: string }).message === 'string'
        ? (raw as { message: string }).message
        : '결제 승인에 실패했습니다.';
    return { ok: false, message: msg, status: res.status >= 400 && res.status < 600 ? res.status : 502 };
  }
  return { ok: true, raw };
}
