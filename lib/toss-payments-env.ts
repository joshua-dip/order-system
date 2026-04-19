/**
 * 토스페이먼츠 환경 변수 — 권장 이름 + 호스팅 대시보드에서 쓰기 쉬운 별칭.
 * @see https://docs.tosspayments.com/reference#인증-헤더
 */

/** 서버: 결제 승인 API Basic 인증용 시크릿 키 */
export function getTossPaymentsSecretKey(): string {
  return (
    process.env.TOSS_PAYMENTS_SECRET_KEY?.trim() ||
    process.env.TOSS_SECRET_KEY?.trim() ||
    ''
  );
}

/** 브라우저 빌드 시 주입 — 결제창 loadTossPayments(clientKey) */
export function getTossPaymentsClientKeyPublic(): string {
  return (
    process.env.NEXT_PUBLIC_TOSS_PAYMENTS_CLIENT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ||
    ''
  );
}

/**
 * 결제위젯 연동 클라이언트 키(`…_gck_…`, `test_gck_`, `live_gck_`) 여부.
 * 포인트 충전은 API 개별 연동 결제창(`payment.requestPayment`)만 사용하므로 위젯 키는 지원하지 않음.
 */
export function isTossWidgetClientKey(clientKey: string): boolean {
  const k = clientKey.trim();
  if (!k) return false;
  return k.includes('_gck_') || /^test_gck_/i.test(k) || /^live_gck_/i.test(k);
}

/** 위젯 키일 때 안내 문구, 아니면 null */
export function tossWidgetKeyRejectionMessage(clientKey: string): string | null {
  if (!isTossWidgetClientKey(clientKey)) return null;
  return (
    '지금 넣은 키는 결제위젯용입니다. 개발자센터 → API 키 → API 개별 연동에서 발급한 ' +
    '클라이언트 키(test_ck_ / live_ck_)와 짝이 맞는 시크릿 키(test_sk_ / live_sk_)로 바꿔 주세요. ' +
    '결제창(SDK) 연동은 결제위젯 키(live_gck_ 등)를 지원하지 않습니다.'
  );
}
