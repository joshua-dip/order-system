/**
 * users.annualMemberSince(등록일) 기준 1년 유효 연회원 여부
 */
export function isAnnualMemberActive(since: Date | string | null | undefined): boolean {
  if (since == null) return false;
  const start = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  return Date.now() < end.getTime();
}
