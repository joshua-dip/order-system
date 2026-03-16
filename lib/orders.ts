/** 회원 주문 시 주문서에 안내할 입금 계좌 */
export const MEMBER_DEPOSIT_ACCOUNT = '110493861106 신한은행 박준규(페이퍼릭)';

/** 주문서 맨 아래 고객용 안내 문구 (입금 계좌 아래에 붙음). 환경 변수 ORDER_FOOTER_MESSAGE로 덮어쓸 수 있음. */
export const ORDER_FOOTER_MESSAGE =
  process.env.ORDER_FOOTER_MESSAGE ||
  `주문해 주셔서 감사합니다.
입금 확인 후 제작이 진행되며, 완료 시 안내해 드립니다. (최대 1일 소요될 수 있습니다)
입금 시 주문자명 기입 부탁드립니다.
문의: 카카오톡 오픈채팅 (페이퍼릭)`;

/**
 * 주문서를 API를 통해 MongoDB(gomijoshua DB)에 저장합니다.
 * orderPrefix: 주문번호 접두어 2글자 (재료+제품, 예: MV=모의고사+변형, BV=부교재+변형, MW=모의고사+워크북). 생략 시 GJ.
 * pointsUsed: 사용할 포인트(원). 회원만 적용되며 주문 시 회원 포인트에서 차감됩니다.
 */
export async function saveOrderToDb(
  orderText: string,
  orderPrefix?: string,
  pointsUsed?: number
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const payload: { orderText: string; orderPrefix?: string; pointsUsed?: number } = { orderText };
    if (orderPrefix) payload.orderPrefix = orderPrefix;
    if (typeof pointsUsed === 'number' && pointsUsed > 0) payload.pointsUsed = pointsUsed;
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
