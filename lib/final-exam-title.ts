/**
 * 내신 예비시험지(옛 「파이널 예비 모의고사」) 이름 — 클라이언트·서버 공용.
 *
 * 2026-09-27 메뉴 이름을 「내신 예비시험지」로 바꿨다. 이미 발급된 잡의 제목은
 * DB 에 「파이널 예비 모의고사 (…)」로 남아 있어, 화면·시험지에 보일 때만 앞머리를 바꿔 보여 준다
 * (저장된 제목은 건드리지 않는다 — 회원이 직접 바꾼 이름은 그대로).
 */
export const FINAL_EXAM_PRODUCT_NAME = '내신 예비시험지';

const LEGACY_PREFIX = /^파이널\s*예비\s*모의고사/;

export function displayFinalExamTitle(title: string): string {
  const t = String(title ?? '').trim();
  return LEGACY_PREFIX.test(t) ? t.replace(LEGACY_PREFIX, FINAL_EXAM_PRODUCT_NAME) : t;
}
