/** admin generated_questions 목록 `q` 파라미터용 (부분 일치 오탐 줄이기) */

import { mockExamSourceLabelAlternates, normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `26년 3월 고2 영어모의고사 32번` 처럼 끝이 `NN번`이면 본문(Paragraph 등) OR 검색을 하지 않고
 * 출처(source)·교재(textbook) 조합으로만 매칭해 다른 번호가 딸려 나오는 것을 방지합니다.
 * `32번`만 입력한 경우에는 source에 `(?<![0-9])32번`만 매칭(132번 오탐 방지).
 */
function sourceRegexOrAlternates(label: string): Record<string, unknown> {
  const forms = mockExamSourceLabelAlternates('', normalizeMockVariantSourceLabel('', label));
  if (forms.length <= 1) {
    return { source: { $regex: escapeRegex(forms[0] ?? label), $options: 'i' } };
  }
  return { $or: forms.map((f) => ({ source: { $regex: escapeRegex(f), $options: 'i' } })) };
}

export function buildVariantQFilter(qRaw: string): Record<string, unknown> | null {
  const t = normalizeMockVariantSourceLabel('', qRaw.trim());
  if (!t) return null;

  const m = t.match(/^(.*?)(\d{1,3})번\s*$/);
  if (m) {
    const prefix = m[1].trim();
    const num = m[2];
    const numBound = `(?<![0-9])${escapeRegex(num)}번`;
    if (prefix.length >= 6) {
      return {
        $or: [
          sourceRegexOrAlternates(t),
          {
            $and: [
              { textbook: { $regex: escapeRegex(prefix), $options: 'i' } },
              { source: { $regex: numBound, $options: 'i' } },
            ],
          },
          {
            $and: [
              { source: { $regex: escapeRegex(prefix), $options: 'i' } },
              { source: { $regex: numBound, $options: 'i' } },
            ],
          },
        ],
      };
    }
    return { source: { $regex: numBound, $options: 'i' } };
  }

  const rx = escapeRegex(t);
  return {
    $or: [
      { source: { $regex: rx, $options: 'i' } },
      { 'question_data.Question': { $regex: rx, $options: 'i' } },
      { 'question_data.Paragraph': { $regex: rx, $options: 'i' } },
      { 'question_data.Options': { $regex: rx, $options: 'i' } },
      { 'question_data.Explanation': { $regex: rx, $options: 'i' } },
      { 'question_data.Category': { $regex: rx, $options: 'i' } },
    ],
  };
}

/** narrative_questions 컬렉션 필드명에 맞춘 동일 규칙 */
export function buildNarrativeQFilter(qRaw: string): Record<string, unknown> | null {
  const t = normalizeMockVariantSourceLabel('', qRaw.trim());
  if (!t) return null;

  const srcOrBody = (field: 'matched' | 'file', rx: string) =>
    field === 'matched'
      ? { source_key_matched: { $regex: rx, $options: 'i' } }
      : { source_file: { $regex: rx, $options: 'i' } };

  const m = t.match(/^(.*?)(\d{1,3})번\s*$/);
  if (m) {
    const prefix = m[1].trim();
    const num = m[2];
    const numBound = `(?<![0-9])${escapeRegex(num)}번`;
    if (prefix.length >= 6) {
      const fullRx = escapeRegex(t);
      return {
        $or: [
          srcOrBody('matched', fullRx),
          srcOrBody('file', fullRx),
          {
            $and: [
              { textbook: { $regex: escapeRegex(prefix), $options: 'i' } },
              { $or: [srcOrBody('matched', numBound), srcOrBody('file', numBound)] },
            ],
          },
          {
            $and: [
              { $or: [srcOrBody('matched', escapeRegex(prefix)), srcOrBody('file', escapeRegex(prefix))] },
              { $or: [srcOrBody('matched', numBound), srcOrBody('file', numBound)] },
            ],
          },
        ],
      };
    }
    return { $or: [srcOrBody('matched', numBound), srcOrBody('file', numBound)] };
  }

  const rx = escapeRegex(t);
  return {
    $or: [
      { source_file: { $regex: rx, $options: 'i' } },
      { source_key_matched: { $regex: rx, $options: 'i' } },
      { 'question_data.문제': { $regex: rx, $options: 'i' } },
      { 'question_data.본문': { $regex: rx, $options: 'i' } },
      { 'question_data.원문': { $regex: rx, $options: 'i' } },
      { 'question_data.해설': { $regex: rx, $options: 'i' } },
      { 'question_data.모범답안': { $regex: rx, $options: 'i' } },
      { narrative_subtype: { $regex: rx, $options: 'i' } },
    ],
  };
}
