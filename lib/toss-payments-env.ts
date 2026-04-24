/**
 * 토스페이먼츠 환경 변수 — 권장 이름 + 호스팅 대시보드에서 쓰기 쉬운 별칭.
 *
 * 이 앱은 **결제위젯** 방식을 사용합니다.
 *   클라이언트 키: test_gck_ / live_gck_   (NEXT_PUBLIC_TOSS_CLIENT_KEY)
 *   시크릿 키  : test_gsk_ / live_gsk_   (TOSS_SECRET_KEY)
 *
 * @see https://docs.tosspayments.com/guides/v2/payment-widget/integration
 */

/** 서버: 결제 승인 API Basic 인증용 시크릿 키 */
export function getTossPaymentsSecretKey(): string {
  return (
    process.env.TOSS_PAYMENTS_SECRET_KEY?.trim() ||
    process.env.TOSS_SECRET_KEY?.trim() ||
    ''
  );
}

/** 브라우저 빌드 시 주입 — 결제위젯 loadTossPayments(clientKey) */
export function getTossPaymentsClientKeyPublic(): string {
  return (
    process.env.NEXT_PUBLIC_TOSS_PAYMENTS_CLIENT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ||
    ''
  );
}

/** 결제위젯 클라이언트 키(`_gck_`) 여부 확인 */
export function isTossWidgetClientKey(clientKey: string): boolean {
  const k = clientKey.trim();
  if (!k) return false;
  return k.includes('_gck_');
}

/** 결제위젯 시크릿 키(`_gsk_`) 여부 확인 */
export function isTossWidgetSecretKey(secretKey: string): boolean {
  const k = secretKey.trim();
  if (!k) return false;
  return k.includes('_gsk_');
}
