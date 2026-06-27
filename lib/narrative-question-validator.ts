/**
 * 서술형 변형(narrative_questions) question_data 검증 — Pro 전용 저장 경로(cc:narrative) 전용.
 * 객관식 변형의 lib/variant-review-validators.ts 에 대응.
 *
 * 보유 5종 subtype:
 *   - 이중요지영작형                : 자유 영작(2개 <u>과제</u> + 답안 단어수 범위)
 *   - 빈칸재배열형(A+B·주제·Hard)   : <보기> 단어 재배열 영작 (키워드 ↔ 모범답안 멀티셋 일치)
 *   - 빈칸재배열형(A+B·어법·Hard)   : 위와 동일 구조(어법 초점)
 *   - 주제완성형                    : 주어진 어구를 변형 없이 활용해 주제를 명사구로 완성 (6단어 이상)
 *   - 요약문빈칸완성형              : 요약문 (A)(B)(C) 빈칸을 지문 속 단어로 단어수 맞춰 채움
 */

export const NARRATIVE_SUBTYPES = [
  '이중요지영작형',
  '빈칸재배열형(A+B·주제·Hard)',
  '빈칸재배열형(A+B·어법·Hard)',
  '주제완성형',
  '요약문빈칸완성형',
] as const;
export type NarrativeSubtype = (typeof NARRATIVE_SUBTYPES)[number];

export function isRearrangeSubtype(s: string): boolean {
  return s.startsWith('빈칸재배열형');
}

export function isTopicCompletionSubtype(s: string): boolean {
  return s === '주제완성형';
}

export function isSummaryBlankSubtype(s: string): boolean {
  return s === '요약문빈칸완성형';
}

export interface SummaryBlankItem {
  기호: string;
  단어수: number;
  답: string;
}

/** question_data.빈칸들 → 정규화 (기호·단어수·답). */
export function parseSummaryBlanks(v: unknown): SummaryBlankItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      기호: typeof o['기호'] === 'string' ? o['기호'].trim() : '',
      단어수: Number(o['단어수']),
      답: typeof o['답'] === 'string' ? o['답'].trim() : '',
    };
  });
}

/** 단어 정규화 — 비교용. 양끝 구두점 제거 + 소문자. */
function normWord(s: string): string {
  return s.toLowerCase().replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/gi, '');
}

/** 주어진표현(' / ' 구분)을 토큰 배열로. 빈 토큰 제거. */
export function givenExpressionTokens(s: string): string[] {
  return s.split('/').map((t) => t.trim()).filter(Boolean);
}

/** 어구가 답안에 (변형 없이) 포함됐는지 — 대소문자 무시 + 공백 정규화 후 부분문자열. */
function answerContainsExpression(answer: string, expr: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(answer).includes(norm(expr));
}

export interface NarrativeValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const STR = (v: unknown): string => (typeof v === 'string' ? v : '');
const wordTokens = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);
/** 키워드는 ' / ' 구분. 구두점 포함한 raw 토큰 그대로 비교(모범답안과 동일 형태). */
const keywordTokens = (s: string): string[] => s.split('/').map((t) => t.trim()).filter(Boolean);

export function validateNarrativeQuestion(
  subtype: string,
  qd: Record<string, unknown>,
): NarrativeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!(NARRATIVE_SUBTYPES as readonly string[]).includes(subtype)) {
    errors.push(`narrative_subtype 는 [${NARRATIVE_SUBTYPES.join(' / ')}] 중 하나여야 합니다. 받은 값: "${subtype}"`);
  }

  // 공통 필수 키
  for (const k of ['문제유형', '문제', '본문', '완전한문제', '모범답안', '해설'] as const) {
    if (!STR(qd[k]).trim()) errors.push(`question_data.${k} 가 비어 있습니다.`);
  }
  const declaredType = STR(qd['문제유형']).trim();
  if (declaredType && declaredType !== subtype) {
    errors.push(`question_data.문제유형("${declaredType}") 이 narrative_subtype("${subtype}") 과 다릅니다.`);
  }
  const score = Number(qd['점수']);
  if (!Number.isFinite(score) || score <= 0) {
    errors.push(`question_data.점수 는 양수여야 합니다. 받은 값: ${JSON.stringify(qd['점수'])}`);
  }
  // 해설/완전한문제 길이 sanity
  if (STR(qd['해설']).trim().length > 600) warnings.push('해설이 600자를 초과합니다. 간결하게 권장.');

  const answer = STR(qd['모범답안']).trim();

  // 해설/모범답안 누출 토큰 (객관식 Explanation 'API'/'nan' 검증과 대응)
  const expl = STR(qd['해설']);
  if (/\bAPI\b/.test(expl) || /\bAPI\b/.test(answer)) {
    errors.push("해설/모범답안에 'API' 토큰이 누출되어 있습니다.");
  }
  if (/\bnan\b/i.test(expl) || /\bnan\b/i.test(answer)) {
    errors.push("해설/모범답안에 'nan' 토큰이 포함되어 있습니다.");
  }

  if (isSummaryBlankSubtype(subtype)) {
    // ── 요약문빈칸완성형: 요약문 (A)(B)(C) 빈칸 + 빈칸별 단어수 일치 + 지문 속 단어 그대로 ──
    const summary = STR(qd['요약문']).trim();
    if (!summary) errors.push("question_data.요약문 이 비어 있습니다. (빈칸 (A)(B)(C) 가 든 한 문장 요약)");
    const passage = STR(qd['본문']);
    const passageWords = new Set(passage.toLowerCase().split(/\s+/).map(normWord).filter(Boolean));
    const passageNorm = passage.toLowerCase().replace(/\s+/g, ' ');
    const blanks = parseSummaryBlanks(qd['빈칸들']);
    if (blanks.length === 0) {
      errors.push("question_data.빈칸들 이 비어 있습니다. ([{기호:'A',단어수:3,답:'...'}] 배열 필수)");
    }
    const seen = new Set<string>();
    for (const b of blanks) {
      if (!b.기호) { errors.push('빈칸 항목에 기호(A/B/C…)가 없습니다.'); continue; }
      if (seen.has(b.기호)) errors.push(`빈칸 기호 (${b.기호}) 가 중복됩니다.`);
      seen.add(b.기호);
      if (summary && !summary.includes(`(${b.기호})`)) {
        errors.push(`요약문에 빈칸 (${b.기호}) 표식이 없습니다.`);
      }
      if (!b.답) { errors.push(`빈칸 (${b.기호}) 의 답이 비어 있습니다.`); continue; }
      const toks = wordTokens(b.답);
      // ① 제시 단어 수와 일치 (하이픈 결합어는 1단어)
      if (Number.isFinite(b.단어수) && toks.length !== b.단어수) {
        errors.push(`빈칸 (${b.기호}) 답 단어 수(${toks.length})가 제시 단어 수(${b.단어수})와 다릅니다. 답="${b.답}"`);
      }
      // ②③ 지문 속 단어를 그대로 — 각 단어가 본문에 존재해야
      if (passage) {
        const missing = toks.filter((t) => !passageWords.has(normWord(t)));
        if (missing.length > 0) {
          errors.push(`빈칸 (${b.기호}) 답의 단어가 지문에 없습니다(조건③ 감점 대상): {${missing.join(', ')}}`);
        } else if (toks.length > 1 && !passageNorm.includes(b.답.toLowerCase().replace(/\s+/g, ' '))) {
          warnings.push(`빈칸 (${b.기호}) 답 "${b.답}" 의 단어들은 지문에 있으나 연속 구로는 보이지 않습니다. 확인 권장.`);
        }
      }
    }
  } else if (isTopicCompletionSubtype(subtype)) {
    // ── 주제완성형: 주어진 어구(변형불가)를 답안에 포함 + 명사구 6단어 이상 ──
    const frame = STR(qd['주제틀']).trim();
    if (!frame) errors.push("question_data.주제틀 이 비어 있습니다. (빈칸 앞 제시 어구, 예: 'the historical pursuit of')");
    const givenRaw = STR(qd['주어진표현']);
    const given = givenExpressionTokens(givenRaw);
    if (given.length === 0) {
      errors.push("question_data.주어진표현 이 비어 있습니다. (' / ' 로 구분된 제시 어구 목록 필수)");
    }
    const minWords = Number.isFinite(Number(qd['최소단어수'])) ? Number(qd['최소단어수']) : 6;
    const ansToks = wordTokens(answer);
    // (1) 주어진 어구가 모두 변형 없이 답안에 포함돼야 한다
    const missing = given.filter((g) => !answerContainsExpression(answer, g));
    if (missing.length > 0) {
      errors.push(`주어진표현이 모범답안에 (변형 없이) 포함되지 않았습니다: {${missing.join(', ')}} / 모범답안="${answer}"`);
    }
    // (2) 답안 단어 수 ≥ 최소단어수 (조건 ②)
    if (ansToks.length < minWords) {
      errors.push(`모범답안 단어 수(${ansToks.length})가 최소 ${minWords}단어 미만입니다. (조건: ${minWords}단어 이상)`);
    }
    // (3) 완전한문제 = 주제틀 + 모범답안 정합 (불일치는 경고)
    const full = STR(qd['완전한문제']).toLowerCase().replace(/\s+/g, ' ').trim();
    const expectFull = `${frame} ${answer}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (full && expectFull && full !== expectFull && !full.includes(answer.toLowerCase().replace(/\s+/g, ' ').trim())) {
      warnings.push('완전한문제가 "주제틀 + 모범답안" 과 정확히 일치하지 않습니다. (구두점 차이면 무시 가능)');
    }
    // (4) 명사구 휴리스틱 — to부정사/정형동사로 시작하면 명사구가 아닐 수 있음(경고)
    if (/^(to\s+|is\b|are\b|was\b|were\b|do\b|does\b|did\b)/i.test(answer)) {
      warnings.push('모범답안이 명사구가 아닐 수 있습니다(to부정사/정형동사 시작). 조건 ③(명사구) 재확인.');
    }
    const ansCount = Number(qd['답안단어수']);
    if (Number.isFinite(ansCount) && ansCount !== ansToks.length) {
      warnings.push(`답안단어수(${ansCount}) 가 실제 모범답안 단어 수(${ansToks.length})와 다릅니다.`);
    }
  } else if (isRearrangeSubtype(subtype)) {
    // ── 빈칸재배열형: 키워드(섞인 단어) ↔ 모범답안(정답 어순) 멀티셋 일치 ──
    const kw = STR(qd['키워드']);
    if (!kw.trim()) {
      errors.push('question_data.키워드 가 비어 있습니다. (빈칸재배열형은 <보기> 단어 목록이 필수)');
    }
    const kwToks = keywordTokens(kw);
    const ansToks = wordTokens(answer);
    if (kwToks.length && ansToks.length) {
      const a = [...kwToks].sort();
      const b = [...ansToks].sort();
      const same = a.length === b.length && a.every((t, i) => t === b[i]);
      if (!same) {
        errors.push(
          `키워드(<보기>) 단어 집합이 모범답안과 일치하지 않습니다. ` +
            `키워드[${kwToks.length}]={${kwToks.join(', ')}} / 모범답안[${ansToks.length}]={${ansToks.join(', ')}}`,
        );
      }
    }
    const kwCount = Number(qd['키워드개수']);
    if (Number.isFinite(kwCount) && kwCount !== kwToks.length) {
      warnings.push(`키워드개수(${kwCount}) 가 실제 키워드 수(${kwToks.length})와 다릅니다.`);
    }
    const ansCount = Number(qd['답안단어수']);
    if (Number.isFinite(ansCount) && ansCount !== ansToks.length) {
      warnings.push(`답안단어수(${ansCount}) 가 실제 모범답안 단어 수(${ansToks.length})와 다릅니다.`);
    }
    if (!STR(qd['완전한문제']).includes('(A)') && !STR(qd['본문']).includes('(A)')) {
      warnings.push("본문/완전한문제에 빈칸 표식 '(A)' 가 보이지 않습니다.");
    }
  } else {
    // ── 이중요지영작형: 2개 <u>과제</u> + 답안 단어수 범위 ──
    const body = `${STR(qd['본문'])} ${STR(qd['문제'])} ${STR(qd['완전한문제'])}`;
    const uCount = (body.match(/<u>/g) || []).length;
    if (uCount < 2) warnings.push(`이중요지영작형은 보통 <u>…</u> 과제 2개가 필요합니다. (발견 ${uCount}개)`);
    const ansToks = wordTokens(answer);
    const ansCount = Number(qd['답안단어수']);
    if (Number.isFinite(ansCount) && Math.abs(ansCount - ansToks.length) > 2) {
      warnings.push(`답안단어수(${ansCount}) 가 실제 모범답안 단어 수(${ansToks.length})와 차이가 큽니다.`);
    }
    const m = body.match(/(\d+)\s*[-~–]\s*(\d+)\s*(?:English\s*)?words/i);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (ansToks.length < lo || ansToks.length > hi) {
        warnings.push(`모범답안 단어 수(${ansToks.length}) 가 제시 범위 ${lo}-${hi} 단어를 벗어납니다.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
