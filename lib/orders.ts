/** 회원 주문 시 주문서에 안내할 입금 계좌 */
export const MEMBER_DEPOSIT_ACCOUNT = '110493861106 신한은행 박준규(페이퍼릭)';

/** 주문서 맨 아래 고객용 안내 문구 (입금 계좌 아래에 붙음). 환경 변수 ORDER_FOOTER_MESSAGE로 덮어쓸 수 있음. */
export const ORDER_FOOTER_MESSAGE =
  process.env.ORDER_FOOTER_MESSAGE ||
  `주문해 주셔서 감사합니다.
입금 확인 후 제작이 진행되며, 완료 시 안내해 드립니다. (최대 1일 소요될 수 있습니다)
입금 시 주문자명 기입 부탁드립니다.
문의: 카카오톡 오픈채팅 (페이퍼릭)`;

export type SaveOrderResult = { ok: boolean; id?: string; error?: string; cancelled?: boolean };

function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 동일 주문서가 짧은 시간에 여러 번 전송되는 것(연타)을 막기 위한 키 */
function orderSaveDedupeKey(
  orderText: string,
  orderPrefix?: string,
  pointsUsed?: number,
  orderMeta?: Record<string, unknown>
): string {
  let metaPart = '';
  if (orderMeta && typeof orderMeta === 'object') {
    try {
      metaPart = JSON.stringify(orderMeta);
    } catch {
      metaPart = '';
    }
  }
  const p = orderPrefix || 'GJ';
  const pt = typeof pointsUsed === 'number' && pointsUsed > 0 ? pointsUsed : 0;
  return `${p}|${pt}|${fnv1a32(`${orderText}\n---META---\n${metaPart}`)}`;
}

const inFlightOrderSaves = new Map<string, Promise<SaveOrderResult>>();

/**
 * 주문서를 API를 통해 MongoDB(gomijoshua DB)에 저장합니다.
 * orderPrefix: 주문번호 접두어 2글자 (재료+제품, 예: MV=모의고사+변형, BV=부교재+변형, MW=모의고사+워크북). 생략 시 GJ.
 * pointsUsed: 사용할 포인트(원). 회원만 적용되며 주문 시 회원 포인트에서 차감됩니다.
 *
 * 동일 본문·접두어·포인트·orderMeta 로 이미 진행 중인 저장 요청이 있으면 그 Promise를 재사용합니다(연타 방지).
 */
export async function saveOrderToDb(
  orderText: string,
  orderPrefix?: string,
  pointsUsed?: number,
  orderMeta?: Record<string, unknown>
): Promise<SaveOrderResult> {
  const key = orderSaveDedupeKey(orderText, orderPrefix, pointsUsed, orderMeta);
  const existing = inFlightOrderSaves.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<SaveOrderResult> => {
    try {
      const payload: {
        orderText: string;
        orderPrefix?: string;
        pointsUsed?: number;
        orderMeta?: Record<string, unknown>;
        confirmDuplicate?: boolean;
      } = { orderText };
      if (orderPrefix) payload.orderPrefix = orderPrefix;
      if (typeof pointsUsed === 'number' && pointsUsed > 0) payload.pointsUsed = pointsUsed;
      if (orderMeta && typeof orderMeta === 'object') payload.orderMeta = orderMeta;

      const postOnce = async () => {
        const r = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({} as Record<string, unknown>));
        return { r, d: d as Record<string, unknown> };
      };

      let { r: res, d: data } = await postOnce();

      // 중복 주문 경고(409): 새 주문의 모든 (지문×유형)을 이미 주문한 "완전 중복".
      // 고객 확인 후 confirmDuplicate 로 재전송 — 진행 시 같은 지문도 새 문제로 재배정.
      if (res.status === 409 && data?.duplicate) {
        const samples = Array.isArray(data.sharedSamples) ? (data.sharedSamples as string[]) : [];
        const sampleLines = samples.length ? `\n\n항목 예시:\n· ${samples.join('\n· ')}` : '';
        const existing = typeof data.existingOrderNumber === 'string' ? ` (${data.existingOrderNumber})` : '';
        const proceed =
          typeof window !== 'undefined' &&
          window.confirm(
            `이미 동일한 주문이 있습니다${existing}.\n` +
              `이 주문의 모든 지문·유형(${data.sharedCount ?? ''}건)을 이전에 주문하셨습니다.${sampleLines}\n\n` +
              `그대로 진행하면 같은 지문도 '새로운 문제'로 다시 배정됩니다.\n계속 주문할까요?`,
          );
        if (!proceed) return { ok: false, cancelled: true, error: '중복 확인에서 취소했습니다.' };
        payload.confirmDuplicate = true;
        ({ r: res, d: data } = await postOnce());
      }

      if (!res.ok) {
        return { ok: false, error: (data?.error as string) || res.statusText };
      }
      return { ok: true, id: data?.id as string | undefined };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return { ok: false, error: message };
    } finally {
      inFlightOrderSaves.delete(key);
    }
  })();

  inFlightOrderSaves.set(key, promise);
  return promise;
}
