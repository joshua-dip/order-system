/**
 * 변형문제 문항당 단가 — 전 주문 흐름 공통 단일 소스(Single Source of Truth).
 *
 * 정책 (2026-06 개편, 영구):
 * - 기본 변형(주제·제목·주장·일치·불일치·함의·빈칸·요약·어법·무관한문장 등): 50원
 * - 고난도(ADVANCED_VARIANT_TYPES: 삽입·어법·빈칸·어휘·순서·요약·무관한문장·함의 -고난도): 80원
 * - 순서·삽입: 해설 포함 50원 / 해설 미포함(문제·답만) 30원
 *
 * 화면별로 단가를 하드코딩하지 말고 반드시 이 모듈을 통해 계산·표기한다.
 */

export const VARIANT_PRICE = {
  /** 기본 변형 문항당 */
  base: 50,
  /** 고난도(ADVANCED_VARIANT_TYPES) 문항당 */
  advanced: 80,
  /** 순서·삽입 — 해설 포함 */
  orderInsertWithExplanation: 50,
  /** 순서·삽입 — 해설 미포함(문제·답만) */
  orderInsertNoExplanation: 30,
} as const;

/** 고난도 유형 (가격표·UI 공통 사용) */
export const ADVANCED_VARIANT_TYPES = [
  '삽입-고난도', '어법-고난도', '빈칸-고난도', '어휘-고난도',
  '순서-고난도', '요약-고난도', '무관한문장-고난도', '함의-고난도',
  '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
] as const;

/**
 * CEFR 어휘 난도로 고난도화한 유형 (대의·일치 계열).
 * 선택지에 C2~C3 어휘를 섞고, 해설에 그 단어의 뜻·유의어를 글로싱한다(검증은 경고).
 * 주장-고난도는 CEFR(영어 어휘) 성립을 위해 영어 선택지를 사용한다(base 주장의 한글 관행과 다름).
 */
export const CEFR_ADVANCED_VARIANT_TYPES = [
  '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
] as const;

/** 해설 포함/미포함 토글이 적용되는 유형 */
export const ORDER_INSERT_TYPES = ['순서', '삽입'] as const;

export function isAdvancedVariantType(type: string): boolean {
  return (ADVANCED_VARIANT_TYPES as readonly string[]).includes(type);
}

export function isOrderInsertType(type: string): boolean {
  return (ORDER_INSERT_TYPES as readonly string[]).includes(type);
}

/**
 * 유형별 문항당 단가.
 *
 * @param type 문제 유형 (예: '주제', '순서', '삽입-고난도')
 * @param opts.withExplanation 순서·삽입 유형일 때 해설 포함 여부 (기본 true)
 */
export function variantUnitPrice(
  type: string,
  opts?: { withExplanation?: boolean },
): number {
  if (isAdvancedVariantType(type)) return VARIANT_PRICE.advanced;
  if (isOrderInsertType(type)) {
    const withExplanation = opts?.withExplanation ?? true;
    return withExplanation
      ? VARIANT_PRICE.orderInsertWithExplanation
      : VARIANT_PRICE.orderInsertNoExplanation;
  }
  return VARIANT_PRICE.base;
}

/**
 * 볼륨 할인율. 200문항 이상 20%, 100문항 이상 10%.
 */
export function variantVolumeDiscountRate(totalQuestions: number): number {
  if (totalQuestions >= 200) return 0.2;
  if (totalQuestions >= 100) return 0.1;
  return 0;
}

/** 순서·삽입 해설 포함/미포함 단가를 한 줄 안내 문구로. 예: '해설 포함 50원 / 문제·답만 30원'. */
export const ORDER_INSERT_PRICE_NOTE = `해설 포함 ${VARIANT_PRICE.orderInsertWithExplanation}원 / 문제·답만 ${VARIANT_PRICE.orderInsertNoExplanation}원`;
