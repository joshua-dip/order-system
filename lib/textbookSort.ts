/**
 * 교재명 목록을 EBS / 개정판 / 기타 로 구분합니다.
 * EBS: 수능특강, 올림포스 등 EBS 교재.
 * 개정판: 이름에 "개정판" 포함 또는 (2024), (2025) 등 최신 연도 표기.
 */
const REVISED_YEAR_MIN = 2024;
const REVISED_PATTERN = /\(20(\d{2})\)/;

const EBS_TEXTBOOKS = new Set([
  '2027수능특강 영어(2026)',
  '2027수능특강 영어독해연습(2026)',
  '올림포스 영어독해 기본1(2024)',
  '올림포스 영어독해 기본2(2024)',
]);

function isEbs(name: string): boolean {
  return EBS_TEXTBOOKS.has(name);
}

/** EBS 교재 여부 (서술형 등에서 EBS 카테고리 분류용) */
export function isEbsTextbook(name: string): boolean {
  return EBS_TEXTBOOKS.has(name);
}

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
  ebs: string[];
  revised: string[];
  other: string[];
} {
  const ebs: string[] = [];
  const revised: string[] = [];
  const other: string[] = [];
  textbookNames.forEach((name) => {
    if (isEbs(name)) ebs.push(name);
    else if (isRevisedEdition(name)) revised.push(name);
    else other.push(name);
  });
  revised.sort(sortByYearDesc);
  ebs.sort(sortByYearDesc);
  return { ebs, revised, other };
}
