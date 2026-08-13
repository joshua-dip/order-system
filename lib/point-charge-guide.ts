/**
 * 포인트 충전 안내 문자 템플릿 — 관리자 화면에서 복사해 문자로 보낸다.
 *
 * 「포인트를 어디서 결제하는지 모르겠다」는 문의가 잦아, 링크와 경로를 함께 적어 준다.
 * 회원 화면의 실제 경로(내 정보 → 💳 포인트 충전 탭)와 문구가 어긋나지 않도록
 * 여기 한 곳에서만 관리한다.
 */
import { POINT_CHARGE_PACKAGES, amountWonForPackage } from './point-charge-packages';

/** 포인트 충전 페이지 절대 URL */
export function pointChargeUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/my/point-charge`;
}

/** 「1만 P 10,000원 / 3만 P 28,500원(5%)」 같은 요약 한 줄 */
export function pointChargePackageSummary(): string {
  return POINT_CHARGE_PACKAGES.map((p) => {
    const won = amountWonForPackage(p).toLocaleString();
    return p.discountPct > 0 ? `${p.label} ${won}원(${p.discountPct}% 할인)` : `${p.label} ${won}원`;
  }).join(' / ');
}

export interface PointChargeGuideInput {
  /** 받는 분 이름 — 비우면 「선생님」 */
  name?: string;
  /** 사이트 origin (https://gomijoshua.com) */
  origin: string;
}

/** 「안수경 선생님」 / 이름이 없으면 「선생님」 — '님'이 겹치지 않게 붙인다 */
function honorific(name?: string): string {
  const n = (name ?? '').trim();
  if (!n) return '선생님';
  return /(님|선생님)$/.test(n) ? n : `${n} 선생님`;
}

/** 단문(SMS)용 — 링크와 핵심만 */
export function buildPointChargeSmsShort({ name, origin }: PointChargeGuideInput): string {
  const who = honorific(name);
  return [
    `[고미조슈아] ${who}, 포인트 충전은 아래 링크에서 가능합니다.`,
    pointChargeUrl(origin),
    '로그인 후 카드 결제되며, 충전 즉시 사용하실 수 있어요.',
  ].join('\n');
}

/** 장문(LMS)용 — 경로·패키지·문의처까지 */
export function buildPointChargeSmsLong({ name, origin }: PointChargeGuideInput): string {
  const who = honorific(name);
  return [
    `[고미조슈아] 포인트 충전 안내`,
    '',
    `${who}, 안녕하세요.`,
    '포인트 충전은 아래 링크에서 바로 하실 수 있습니다.',
    '',
    `▶ ${pointChargeUrl(origin)}`,
    '',
    '［충전 방법］',
    '1. 위 링크를 눌러 로그인해 주세요.',
    '2. 충전할 포인트를 고르고 카드로 결제하시면 됩니다.',
    '3. 결제 즉시 포인트가 들어가고, 주문할 때 바로 쓰실 수 있어요.',
    '',
    '［홈페이지에서 찾아가실 때］',
    '내 정보 → 💳 포인트 충전 탭',
    '',
    '［충전 금액］',
    pointChargePackageSummary(),
    '',
    '궁금하신 점은 이 번호로 편하게 연락 주세요.',
  ].join('\n');
}
