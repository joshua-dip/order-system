/**
 * 서술형 출제기 — Claude 가 만든 ExamData JSON 의 정합성 검증.
 *
 * Claude 응답에 종종 다음 부정합이 발생한다:
 *   - answer.text 단어 수 ≠ word_count.total
 *   - bogi 청크들을 합친 결과 ≠ answer.text
 *   - "N개의 단어" 조건의 N ≠ word_count.total
 *
 * 저장 전 이 검증을 통과시켜야 안전하다. CLI `save` 의 기본은 strict (errors 가
 * 1개라도 있으면 거부). `--force` 로 모든 errors 를 warnings 로 격하 가능.
 */

import type { ExamData, Question } from './essay-exam-html';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** 영어 텍스트를 단어 단위로 잘라내기. 쉼표·종결구두점 제거 후 공백 분리. */
function tokenizeWords(text: string): string[] {
  return text
    .replace(/[,.;:!?"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** bogi 문자열 ("a / b / c") 을 청크 배열로 자르기. */
function splitBogi(bogi: string): string[] {
  return bogi
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
}

/** 비교용 정규화: 쉼표·종결구두점 제거, 다중 공백 정리, 소문자 비교는 X (대소문자 보존). */
function normalizeForCompare(text: string): string {
  return text
    .replace(/[,.;:!?"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateQuestion(q: Question, errors: string[], warnings: string[]) {
  const qid = `Q${q.id}`;

  if (!q.answer || typeof q.answer !== 'object') {
    errors.push(`${qid}: answer 객체가 없습니다.`);
    return;
  }
  if (!q.bogi || typeof q.bogi !== 'string') {
    errors.push(`${qid}: bogi 가 없습니다.`);
    return;
  }
  if (!Array.isArray(q.conditions)) {
    errors.push(`${qid}: conditions 배열이 없습니다.`);
    return;
  }

  const answerText = q.answer.text ?? '';
  const wc = q.answer.word_count;

  // 1) answer.text 단어 수 정합성
  const tokens = tokenizeWords(answerText);
  if (!wc || typeof wc !== 'object') {
    errors.push(`${qid}: answer.word_count 가 없습니다.`);
  } else {
    if (typeof wc.total !== 'number') {
      errors.push(`${qid}: word_count.total 이 숫자가 아닙니다.`);
    } else if (tokens.length !== wc.total) {
      errors.push(
        `${qid}: answer.text 단어수(${tokens.length}) ≠ word_count.total(${wc.total}). text="${answerText}"`,
      );
    }
    if (!Array.isArray(wc.words)) {
      errors.push(`${qid}: word_count.words 배열이 없습니다.`);
    } else if (typeof wc.total === 'number' && wc.words.length !== wc.total) {
      errors.push(
        `${qid}: word_count.words 길이(${wc.words.length}) ≠ word_count.total(${wc.total}).`,
      );
    }
  }

  // 2) bogi 청크 합 ↔ answer.text
  const bogiChunks = splitBogi(q.bogi);
  if (bogiChunks.length === 0) {
    errors.push(`${qid}: bogi 청크가 0개입니다.`);
  } else {
    const bogiJoinedNorm = normalizeForCompare(bogiChunks.join(' '));
    const answerNorm = normalizeForCompare(answerText);
    if (bogiJoinedNorm !== answerNorm) {
      // 부분 일치 (쉼표 위치 차이 등) 허용 여부: 정확 일치만 통과.
      // 그러나 청크 순서가 섞여 있어도 학생이 정렬해야 하는 경우가 있을 수 있으니,
      // 기본은 errors. 청크 셋이 같으면 warning 으로 격하.
      const bogiSorted = [...bogiChunks].map(s => normalizeForCompare(s)).sort().join('|');
      const answerWords = normalizeForCompare(answerText).split(' ');
      // answer 를 bogi 청크와 동일한 단어 수로 균등 분할은 불가능 → 단순히 모든 청크 단어가
      // answer 에 등장하는지 확인.
      const allChunksInAnswer = bogiChunks.every(ch => {
        const chNorm = normalizeForCompare(ch);
        return normalizeForCompare(answerText).includes(chNorm);
      });
      if (allChunksInAnswer) {
        warnings.push(
          `${qid}: bogi 청크가 answer.text 에 모두 포함되지만 순서/구두점이 다릅니다. (bogi 정렬: ${bogiSorted}, answer 단어수: ${answerWords.length})`,
        );
      } else {
        errors.push(
          `${qid}: bogi 청크 합이 answer.text 와 불일치합니다. bogi="${bogiChunks.join(' / ')}" / answer="${answerText}"`,
        );
      }
    }
  }

  // 3) "N개의 단어" 조건 ↔ word_count.total
  if (Array.isArray(q.conditions) && wc?.total != null) {
    const wordCountCond = q.conditions.find(c => /\d+\s*개의?\s*단어/.test(c));
    if (wordCountCond) {
      const m = wordCountCond.match(/(\d+)\s*개의?\s*단어/);
      const n = m ? parseInt(m[1], 10) : NaN;
      if (Number.isFinite(n) && n !== wc.total) {
        errors.push(
          `${qid}: 조건의 단어수(${n}개) ≠ word_count.total(${wc.total}). 조건="${wordCountCond}"`,
        );
      }
    } else {
      warnings.push(`${qid}: conditions 안에 "N개의 단어" 문구가 없습니다. (관례 위반)`);
    }
  }

  // 4) conditions 길이 권장 (마스터 프롬프트 기준 7~8개)
  if (Array.isArray(q.conditions)) {
    if (q.conditions.length < 6 || q.conditions.length > 9) {
      warnings.push(
        `${qid}: conditions 개수(${q.conditions.length}) 가 권장 범위(7~8) 를 벗어났습니다.`,
      );
    }
  }

  // 5) bogi 청크 개수 권장 (7~10)
  if (bogiChunks.length < 5 || bogiChunks.length > 12) {
    warnings.push(
      `${qid}: bogi 청크 개수(${bogiChunks.length}) 가 권장 범위(7~10) 를 벗어났습니다.`,
    );
  }
}

/**
 * ExamData 전체 정합성 검증.
 * - errors : 저장 거부 사유 (정량적 불일치)
 * - warnings : 권장 위반 (저장은 가능)
 */
export function validateExamData(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'], warnings };
  }

  const d = data as Partial<ExamData>;

  if (!d.meta || typeof d.meta !== 'object') {
    errors.push('meta 객체가 없습니다.');
  } else {
    if (typeof d.meta.title !== 'string' || !d.meta.title.trim()) {
      errors.push('meta.title 이 비어 있습니다.');
    }
    if (typeof d.meta.subtitle !== 'string') {
      errors.push('meta.subtitle 이 문자열이 아닙니다.');
    }
    if (!Array.isArray(d.meta.info)) {
      errors.push('meta.info 배열이 없습니다.');
    }
  }

  if (!d.question_set || typeof d.question_set !== 'object') {
    errors.push('question_set 객체가 없습니다.');
  } else {
    if (!d.question_set.tag) errors.push('question_set.tag 가 비어 있습니다.');
    if (!d.question_set.instruction) errors.push('question_set.instruction 이 비어 있습니다.');
  }

  if (typeof d.passage !== 'string' || !d.passage.trim()) {
    errors.push('passage 가 비어 있습니다.');
  }

  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    errors.push('questions 배열이 비어 있습니다.');
  } else {
    for (const q of d.questions) {
      validateQuestion(q, errors, warnings);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
