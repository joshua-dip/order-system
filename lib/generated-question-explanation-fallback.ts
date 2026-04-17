/**
 * 변형문 `question_data.Explanation`이 비어 있을 때만 보강(기존 비어 있지 않은 값은 덮어쓰지 않음).
 */

function pickStr(qd: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = qd[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function isGeneratedQuestionExplanationEmpty(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw !== 'string') return true;
  return raw.trim().length === 0;
}

function lineForCorrectOption(opts: string, correctAnswer: string): string {
  if (!opts.trim() || !correctAnswer.trim()) return '';
  const token = correctAnswer.replace(/\s/g, '').slice(0, 2);
  for (const line of opts.split(/\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith(correctAnswer.trim())) return t;
    if (token && t.startsWith(token)) return t;
  }
  return '';
}

function explainSentenceForCategory(cat: string): string {
  switch (cat.trim()) {
    case '주제':
      return '글 전체의 요지·결론과 가장 잘 맞는 선택지이며, 지문의 핵심 논지와 연결됩니다.';
    case '제목':
      return '글의 핵심 메시지를 짧게 함축한 제목으로, 지문의 범위와 톤에 맞습니다.';
    case '주장':
      return '필자가 분명히 밝히는 주장과 일치하는 선택지이며, 지문의 논지 전개와 맞물립니다.';
    case '일치':
      return '지문에 근거가 명시된 내용과 일치하는 선택지입니다.';
    case '불일치':
      return '지문 내용과 어긋나거나 과장·왜곡된 부분을 가리키는 선택지입니다.';
    case '함의':
      return '지문에 직접 쓰이지 않았으나 논리적으로 따라올 수 있는 함의에 해당합니다.';
    case '빈칸':
      return '문맥상 빈칸에 들어갈 어휘·구로 가장 자연스럽고 의미가 통합니다.';
    case '요약':
      return '지문의 정보를 빠짐없이·과장 없이 요약한 문장에 해당합니다.';
    case '어법':
      return '문법·관용에 맞는 표현이며, 지문의 밑줄 위치와 문맥에 맞습니다.';
    case '순서':
      return '담화 흐름상 앞뒤 문장이 자연스럽게 이어지는 순서입니다.';
    case '삽입':
    case '삽입-고난도':
      return '삽입 위치의 앞뒤 문맥과 접속 관계가 가장 자연스러운 곳입니다.';
    case '무관한문장':
      return '글의 주제·논지 전개와 관계없는 문장으로, 전체 흐름에서 벗어난 문장입니다.';
    default:
      return '지문과 발문을 종합할 때 가장 적절한 응답입니다.';
  }
}

/**
 * @returns 보강된 `question_data` 전체, 또는 보강 불필요·불가 시 `null`
 */
export function enrichQuestionDataWithExplanationIfEmpty(
  questionData: Record<string, unknown>,
  type: string,
): Record<string, unknown> | null {
  const ex = questionData.Explanation ?? questionData.explanation;
  if (!isGeneratedQuestionExplanationEmpty(ex)) return null;

  const cat = pickStr(questionData, ['Category', 'category']) || type.trim();
  const ca = pickStr(questionData, ['CorrectAnswer', 'correctAnswer', '정답']);
  const opts = pickStr(questionData, ['Options', 'options', '보기']);
  const optLine = lineForCorrectOption(opts, ca);
  const body = explainSentenceForCategory(cat || type);

  const firstLine =
    optLine && ca
      ? optLine.startsWith(ca.trim())
        ? optLine
        : `${ca.trim()} ${optLine.replace(/^[①②③④⑤]\s*/, '').slice(0, 120)}`
      : ca
        ? `${ca.trim()} 정답`
        : '정답';

  const explanation = `${firstLine}\n*해설: ${body}`;

  return {
    ...questionData,
    Explanation: explanation,
  };
}
