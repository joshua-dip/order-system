/** 1P = 1원 충전. 고액 패키지는 결제 금액(원)에 할인 적용 */
export type PointChargeTierId = 'p10k' | 'p30k' | 'p50k' | 'p100k';

export type PointChargePackage = {
  id: PointChargeTierId;
  points: number;
  /** 결제 금액 할인율 (%) */
  discountPct: number;
  label: string;
};

export const POINT_CHARGE_PACKAGES: PointChargePackage[] = [
  { id: 'p10k', points: 10_000, discountPct: 0, label: '1만 P' },
  { id: 'p30k', points: 30_000, discountPct: 5, label: '3만 P' },
  { id: 'p50k', points: 50_000, discountPct: 10, label: '5만 P' },
  { id: 'p100k', points: 100_000, discountPct: 15, label: '10만 P' },
];

export function amountWonForPackage(p: PointChargePackage): number {
  return Math.round((p.points * (100 - p.discountPct)) / 100);
}

export function getPointChargePackage(tier: string): PointChargePackage | null {
  const t = tier as PointChargeTierId;
  return POINT_CHARGE_PACKAGES.find((p) => p.id === t) ?? null;
}
