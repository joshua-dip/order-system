/**
 * 단어장 UI·구매·다운로드에서 쓰는 지문 레이블.
 * `passages.chapter` 에 공백이 포함될 수 있어(예: "3월 고1 영어모의고사") 첫 공백으로 나누면 안 됩니다.
 */
export function lessonLabelFromPassageRow(p: { chapter?: string; number?: string }): string {
  return [p.chapter ?? '', p.number ?? ''].filter(Boolean).join(' ').trim();
}
