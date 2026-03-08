/**
 * 교재명 목록을 개정판(상단) / 기타 로 구분합니다.
 * 개정판: 이름에 "개정판" 포함 또는 (2024), (2025) 등 최신 연도 표기.
 */
const REVISED_YEAR_MIN = 2024;
const REVISED_PATTERN = /\(20(\d{2})\)/;

function isRevisedEdition(name: string): boolean {
  if (name.includes('개정판')) return true;
  const match = name.match(REVISED_PATTERN);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const fullYear = 2000 + year;
  return fullYear >= REVISED_YEAR_MIN;
}

function sortByYearDesc(a: string, b: string): number {
  const yearA = (a.match(REVISED_PATTERN) || [])[1];
  const yearB = (b.match(REVISED_PATTERN) || [])[1];
  if (!yearA && !yearB) return 0;
  if (!yearA) return 1;
  if (!yearB) return -1;
  return parseInt(yearB, 10) - parseInt(yearA, 10);
}

export function groupTextbooksByRevised(textbookNames: string[]): {
  revised: string[];
  other: string[];
} {
  const revised: string[] = [];
  const other: string[] = [];
  textbookNames.forEach((name) => {
    if (isRevisedEdition(name)) revised.push(name);
    else other.push(name);
  });
  revised.sort(sortByYearDesc);
  return { revised, other };
}
