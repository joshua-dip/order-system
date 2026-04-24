export type StreakData = { count: number; lastVisitedAt: Date };

/**
 * 자정 기준으로 스트릭을 +1 또는 1로 reset.
 * 순수 함수 — DB 호출 없음.
 */
export function bumpStreak(prev?: StreakData): StreakData {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!prev?.lastVisitedAt) {
    return { count: 1, lastVisitedAt: today };
  }

  const last = new Date(prev.lastVisitedAt);
  const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  const diffDays = Math.round((today.getTime() - lastDay.getTime()) / 86400000);

  if (diffDays === 0) return prev;
  if (diffDays === 1) return { count: prev.count + 1, lastVisitedAt: today };
  return { count: 1, lastVisitedAt: today };
}
