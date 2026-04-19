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
