/**
 * 기출문제 업로드 보상 포인트 — 지급 로직과 화면 문구의 단일 소스.
 *
 * 관리자가 업로드 건을 확인해 승인할 때 지급한다.
 * 답지(정답·해설)까지 함께 올린 건은 더 높은 금액을 준다.
 */

/** 문제만 올린 경우 */
export const PAST_EXAM_REWARD_POINTS = 50_000;

/** 답지(정답·해설)까지 함께 올린 경우 */
export const PAST_EXAM_REWARD_POINTS_WITH_ANSWERS = 60_000;
