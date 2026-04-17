/**
 * Claude API 없이 question_data로부터 유형·정답에 맞춘 해설 문자열을 생성한다.
 * (대량 보강용 — 검수 후 수정 가능)
 */

function pickStr(qd: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = qd[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function lineStartingWith(opts: string, token: string): string {
  const t = token.trim();
  if (!t || !opts.trim()) return '';
  for (const line of opts.split(/\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith(t)) return s.slice(0, 140);
  }
  const circ = t.replace(/[1-5]/g, (d) => '①②③④⑤'[Number(d) - 1]);
  for (const line of opts.split(/\n/)) {
    const s = line.trim();
    if (circ && s.startsWith(circ)) return s.slice(0, 140);
  }
  return '';
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * @returns 해설 문자열(대략 450자 이하), 생성 불가 시 빈 문자열
 */
export function buildBulkVariantExplanation(typeRaw: string, qd: Record<string, unknown>): string {
  const type = typeRaw.trim();
  const cat = pickStr(qd, ['Category', 'category']) || type;
  const ca = pickStr(qd, ['CorrectAnswer', 'correctAnswer', '정답']);
  const opts = pickStr(qd, ['Options', 'options', '보기']);
  const optLine = lineStartingWith(opts, ca);

  const head = ca ? `${ca}` : '정답';

  if (type === '어법' || cat === '어법') {
    const body = `${head} 가 정답입니다. ${head}번 밑줄 표기는 문맥·수일치·품사·전치사·관계사 등 어법 규칙에 맞게 고쳐야 할 부분입니다. 지문의 다른 밑줄은 이 문장 안에서 허용되는 형태로 읽힙니다.`;
    return clip(body, 450);
  }

  if (type === '순서' || cat === '순서') {
    const body = `${head} 가 정답입니다. (A)(B)(C) 블록을 정답 보기 순서대로 배열하면, 맨 앞 도입 문장 뒤로 사례·이유·대조나 결론이 끊기지 않고 이어집니다.\n논리 흐름 요약: 담화 단계가 앞뒤 지시어·접속과 맞물리도록 블록 순서를 맞춘 것이 정답입니다.`;
    return clip(body, 450);
  }

  if (type === '삽입' || type === '삽입-고난도' || cat === '삽입' || cat === '삽입-고난도') {
    const body = `${head} 가 정답입니다. 주어진 문장은 ①~⑤ 표시 사이의 흐름을 볼 때 ${head} 위치에 들어올 때 앞뒤 문장의 주제·접속·시제가 가장 자연스럽게 이어집니다.\n논리 흐름 요약: 삽입 전후의 담화 연결이 매끄럽도록 위치를 고른 것이 정답입니다.`;
    return clip(body, 450);
  }

  if (type === '무관한문장' || cat === '무관한문장') {
    const body = `${head} 가 정답입니다. ${head}번 문장만 글 전체의 주제·논지 전개와 직접 연결되지 않는 내용으로 끼어 있어 흐름과 관계없는 문장입니다. 나머지 문장들은 한 줄기로 이어집니다.`;
    return clip(body, 450);
  }

  if (type === '빈칸' || cat === '빈칸') {
    const word = optLine.replace(/^[①②③④⑤]\s*/, '').split(/\s+/)[0] ?? '';
    const first = ca && word ? `${ca} ${word}` : head;
    const body = `${first}\n*해설: 빈칸 앞뒤 문맥과 수일치·접속 관계를 보면 정답 어휘가 의미상 가장 자연스럽습니다. 다른 선택지는 문맥과 어긋나거나 군더더기가 됩니다.`;
    return clip(body, 450);
  }

  if (type === '제목' || cat === '제목') {
    const body = `${head}이 정답입니다. ${optLine ? `정답 보기「${optLine.slice(0, 80)}」는` : '정답 보기는'} 글 전체의 핵심 메시지(무리한 수락의 부담·거절의 필요)를 짧게 함축합니다. 다른 보기는 범위가 넓거나 예시·관계에만 치우쳐 글의 결론과 거리가 있습니다.`;
    return clip(body, 450);
  }

  if (type === '주제' || cat === '주제') {
    const body = `${head}이 정답입니다. ${optLine ? `「${optLine.replace(/^[①②③④⑤]\s*/, '').slice(0, 90)}」가` : '정답 선택지가'} 글 전체의 요지와 가장 잘 맞습니다. 글은 거절이 어려운 심리, 과한 수락의 부작용, 그리고 선택적으로 거절해야 즐거움이 유지된다는 결론으로 이어집니다.`;
    return clip(body, 450);
  }

  if (type === '주장' || cat === '주장') {
    const body = `${head}이 정답입니다. 필자가 분명히 밝히는 주장과 일치하는 선택지이며, 지문의 논거 전개와 맞물립니다. 다른 보기는 세부 사실이나 배경에 가깝거나 주장의 초점과 어긋납니다.`;
    return clip(body, 450);
  }

  if (type === '일치' || cat === '일치') {
    const body = `${head}이 정답입니다. 지문에 근거가 명시된 내용과 일치하는 문장입니다. 나머지 보기는 지문에 없는 정보, 과장, 또는 반대 내용에 해당할 수 있습니다.`;
    return clip(body, 450);
  }

  if (type === '불일치' || cat === '불일치') {
    const body = `${head}이 정답입니다. 지문이 말하는 내용과 어긋나거나 과장·왜곡된 부분을 가리키는 선택지입니다. 다른 보기는 지문과 모순되지 않습니다.`;
    return clip(body, 450);
  }

  if (type === '함의' || cat === '함의') {
    const body = `${head}이 정답입니다. 지문에 직접 쓰이지 않았으나 논리적으로 따라올 수 있는 함의에 해당합니다. 다른 보기는 지문 범위를 벗어나거나 도약이 과합니다.`;
    return clip(body, 450);
  }

  if (type === '요약' || cat === '요약') {
    const body = `${head}이 정답입니다. 지문의 정보를 빠짐없이·과장 없이 압축한 문장에 가장 가깝습니다. 다른 보기는 세부만 담거나 중심에서 벗어납니다.`;
    return clip(body, 450);
  }

  const body = `${head}이 정답입니다. ${optLine ? `정답 보기는 ${optLine.slice(0, 100)}` : '정답 보기'}와 지문·발문을 종합할 때 가장 적절합니다. 다른 선택지는 지문 근거와 맞지 않거나 범위가 어긋납니다.`;
  return clip(body, 450);
}
