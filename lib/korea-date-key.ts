/** 한국 시간 기준 날짜 키 YYYY-MM-DD (집계·통계용) */
export function koreaDateKey(ref: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
}

/** 한국 시간 기준 연-월 키 YYYY-MM (매출 월별 집계용) */
export function koreaYearMonthKey(ref: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(ref);
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  if (!y || !mo) {
    const d = new Date(ref);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${y}-${mo}`;
}
