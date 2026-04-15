/** 변형문제 만들기 — 삽입-고난도 1문항 생성 시 차감 포인트 */
export const VARIANT_HARD_INSERTION_POINT_COST = 5;

export function variantTypeRequiresHardInsertionPoints(type: string): boolean {
  return type.trim() === '삽입-고난도';
}

/** 초안 1개 생성 시 차감 포인트. 무료 유형은 null */
export function variantTypePointCostPerDraft(type: string): number | null {
  return variantTypeRequiresHardInsertionPoints(type) ? VARIANT_HARD_INSERTION_POINT_COST : null;
}
