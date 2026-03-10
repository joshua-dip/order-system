/**
 * 주문번호 접두어 2글자 정의
 * 1글자: 재료 유형 (M=모의고사, B=부교재, E=EBS)
 * 2글자: 제품 유형 (V=변형문제, D=서술형, W=워크북, A=분석지)
 */
export const ORDER_PREFIX = {
  /** 모의고사 + 변형문제 */
  MOCK_VARIANT: 'MV',
  /** 모의고사 + 워크북 */
  MOCK_WORKBOOK: 'MW',
  /** 부교재 + 변형문제 */
  BOOK_VARIANT: 'BV',
  /** 부교재 + 워크북 */
  BOOK_WORKBOOK: 'BW',
  /** EBS + 변형문제 (등 필요 시 추가) */
  EBS_VARIANT: 'EV',
} as const;
