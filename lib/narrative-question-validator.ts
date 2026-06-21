/**
 * 서술형 변형(narrative_questions) question_data 검증 — Pro 전용 저장 경로(cc:narrative) 전용.
 * 객관식 변형의 lib/variant-review-validators.ts 에 대응.
 *
 * 보유 3종 subtype:
 *   - 이중요지영작형                : 자유 영작(2개 <u>과제</u> + 답안 단어수 범위)
 *   - 빈칸재배열형(A+B·주제·Hard)   : <보기> 단어 재배열 영작 (키워드 ↔ 모범답안 멀티셋 일치)
 *   - 빈칸재배열형(A+B·어법·Hard)   : 위와 동일 구조(어법 초점)
 */

export const NARRATIVE_SUBTYPES = [
  '이중요지영작형',
  '빈칸재배열형(A+B·주제·Hard)',
  '빈칸재배열형(A+B·어법·Hard)',
] as const;
export type NarrativeSubtype = (typeof NARRATIVE_SUBTYPES)[number];

export function isRearrangeSubtype(s: string): boolean {
  return s.startsWith('빈칸재배열형');
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

  if (isRearrangeSubtype(subtype)) {
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
