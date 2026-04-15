/**
 * passages 컬렉션 행 → LessonSelection용 강(챕터)별 번호 목록.
 * 선택 값은 주문/검증에서 쓰는 문자열과 동일하게 `${chapter} ${number}` (모의고사형은 예외).
 */
export type PassageLessonRow = {
  textbook?: string;
  chapter?: string;
  number?: string;
};

export function buildLessonGroupsFromPassageRows(
  rows: PassageLessonRow[],
  textbook: string,
): Record<string, string[]> {
  const tbWant = textbook.trim();
  const groups: Record<string, string[]> = {};

  for (const p of rows) {
    const tb = typeof p.textbook === 'string' ? p.textbook.trim() : '';
    if (!tbWant || tb !== tbWant) continue;

    const chapter = typeof p.chapter === 'string' ? p.chapter.trim() : '';
    const number = typeof p.number === 'string' ? p.number.trim() : '';

    const isMockExam = tb !== '' && chapter === tb;
    const lessonKey = isMockExam ? '전체' : chapter || '기타';
    const label = isMockExam ? number : `${chapter} ${number}`.trim();
    if (!label) continue;

    if (!groups[lessonKey]) groups[lessonKey] = [];
    if (!groups[lessonKey].includes(label)) groups[lessonKey].push(label);
  }

  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b, 'ko', { numeric: true });
    });
  }

  return groups;
}
