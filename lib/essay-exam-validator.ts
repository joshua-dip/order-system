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
import { ESSAY_MEANING_EXAM_TYPE } from '@/app/data/essay-categories';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** 영어 텍스트를 단어 단위로 잘라내기. 쉼표·종결구두점 제거 후 공백 분리. */
function tokenizeWords(text: string): string[] {
  return text
    .replace(/[,.;:!?"─—–]/g, ' ')
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
    .replace(/[,.;:!?"─—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateQuestion(
  q: Question,
  errors: string[],
  warnings: string[],
  difficulty?: string,
  examType?: string,
) {
  const qid = `Q${q.id}`;
  const isMaxDifficulty = difficulty === '최고난도';
  const isHardDifficulty = difficulty === '고난도';
  const isMidDifficulty = difficulty === '중난도';
  /* 글의의미 서술형: 기본=우리말 서술 / 중·고=키워드 영작 / 최고=키워드 없는 영작 */
  const isMeaningType = (examType ?? '') === ESSAY_MEANING_EXAM_TYPE;
  const isBasicDifficulty = difficulty === '기본난도' || difficulty === '난이도하';
  const meaningBasic = isMeaningType && isBasicDifficulty;

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
  } else if (meaningBasic) {
    // 글의의미 기본: answer 가 우리말 서술이라 영어 단어수 엄격 일치는 생략.
    // (HTML "단어 수" 칸 렌더용으로 words 배열·total 내부 정합만 확인)
    if (!Array.isArray(wc.words)) {
      errors.push(`${qid}: word_count.words 배열이 없습니다.`);
    } else if (typeof wc.total === 'number' && wc.words.length !== wc.total) {
      errors.push(
        `${qid}: word_count.words 길이(${wc.words.length}) ≠ word_count.total(${wc.total}).`,
      );
    }
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

  if (isMeaningType) {
    // 글의의미: 기본=우리말 서술 / 중·고=키워드 영작 / 최고=키워드 없는 영작
    if (meaningBasic) {
      // 답은 우리말 서술, bogi = 밑줄 친 부분 영어 원문(참고용).
      if (!/[가-힯]/.test(answerText)) {
        errors.push(`${qid}: 글의의미 기본난도는 answer.text 를 우리말로 서술해야 합니다. text="${answerText}"`);
      }
      if (!q.bogi.trim()) {
        warnings.push(`${qid}: 글의의미 기본난도 bogi(밑줄 친 부분 원문)가 비어 있습니다.`);
      }
    } else {
      // 영작 3종: answer.text 는 영어.
      if (!/[A-Za-z]{2,}/.test(answerText)) {
        errors.push(`${qid}: 글의의미 ${difficulty ?? ''} answer.text 는 영어 영작문이어야 합니다. text="${answerText}"`);
      }
      if (isMaxDifficulty) {
        // 키워드 없음 — bogi = 우리말 의미문.
        if (!/[가-힯]/.test(q.bogi)) {
          errors.push(`${qid}: 글의의미 최고난도는 bogi 에 우리말 의미문을 넣어야 합니다. bogi="${q.bogi}"`);
        }
      } else {
        // 중·고: 키워드 풀(영어 lemma, 알파벳순). 중=다수, 고=소수.
        const bogiChunks = splitBogi(q.bogi);
        const [lo, hi] = isMidDifficulty ? [8, 16] : [4, 9];
        if (bogiChunks.length === 0) {
          errors.push(`${qid}: bogi 키워드가 0개입니다.`);
        } else if (bogiChunks.length < lo || bogiChunks.length > hi) {
          warnings.push(
            `${qid}: 글의의미 ${difficulty ?? ''} 키워드 개수(${bogiChunks.length}) 가 권장 범위(${lo}~${hi}) 를 벗어났습니다.`,
          );
        }
        const sortedAsc = [...bogiChunks].map(s => s.toLowerCase()).sort();
        const givenLc = bogiChunks.map(s => s.toLowerCase());
        if (bogiChunks.length > 0 && givenLc.join('|') !== sortedAsc.join('|')) {
          warnings.push(
            `${qid}: 글의의미 키워드는 알파벳순(어순 노출 방지)이 권장됩니다. 현재="${bogiChunks.join(' / ')}"`,
          );
        }
      }
    }
  } else if (isMaxDifficulty) {
    // 최고난도: bogi = 한국어 해석문 한 줄. 슬래시 청크 합 검사·청크 개수 검사 스킵.
    // 한국어 문자가 하나라도 들어있는지만 가볍게 확인.
    if (!/[가-힯]/.test(q.bogi)) {
      errors.push(`${qid}: 최고난도는 bogi 에 한국어 해석문을 넣어야 합니다. bogi="${q.bogi}"`);
    }
  } else if (isHardDifficulty) {
    // 고난도: bogi = 키워드(lemma) 알파벳순 풀. 청크 합 검사 스킵 (lemma 와 굴절형 차이 때문).
    const bogiChunks = splitBogi(q.bogi);
    if (bogiChunks.length === 0) {
      errors.push(`${qid}: bogi 키워드가 0개입니다.`);
    } else if (bogiChunks.length < 5 || bogiChunks.length > 10) {
      warnings.push(
        `${qid}: 고난도 키워드 개수(${bogiChunks.length}) 가 권장 범위(5~10) 를 벗어났습니다.`,
      );
    }
    /* 알파벳순 정렬 권장 */
    const sortedAsc = [...bogiChunks].map(s => s.toLowerCase()).sort();
    const givenLc = bogiChunks.map(s => s.toLowerCase());
    if (givenLc.join('|') !== sortedAsc.join('|')) {
      warnings.push(
        `${qid}: 고난도 키워드는 알파벳순(어순 노출 방지)이 권장됩니다. 현재="${bogiChunks.join(' / ')}"`,
      );
    }
  } else if (isMidDifficulty) {
    // 중난도: bogi 청크 7~10개. 그 중 1~2개는 의도적 변형 (정답과 다른 어형).
    // → 청크 합 = answer 검사 스킵. 대신 변형 청크 개수만 1~2 인지 확인.
    const bogiChunks = splitBogi(q.bogi);
    if (bogiChunks.length === 0) {
      errors.push(`${qid}: bogi 청크가 0 개입니다.`);
    } else {
      /* 변형 식별: 청크의 토큰 중 단 하나라도 answer 의 토큰 집합에 없으면 변형 청크.
         (substring 매칭은 'happen' ⊂ 'happens' 처럼 굴절 변형을 놓쳐 단어-경계 비교 사용) */
      const answerTokenSet = new Set(tokenizeWords(answerText).map(t => t.toLowerCase()));
      const variantChunks = bogiChunks.filter(ch => {
        const chTokens = tokenizeWords(ch).map(t => t.toLowerCase());
        return chTokens.some(t => !answerTokenSet.has(t));
      });
      if (variantChunks.length === 0) {
        warnings.push(
          `${qid}: 중난도이지만 변형 청크가 0 개입니다. 1~2 개의 의도적 어형 변형이 필요합니다.`,
        );
      } else if (variantChunks.length > 2) {
        warnings.push(
          `${qid}: 중난도 변형 청크가 ${variantChunks.length} 개 — 권장 범위(1~2)를 초과했습니다. (${variantChunks.map(c => `"${c}"`).join(', ')})`,
        );
      }
      if (bogiChunks.length < 5 || bogiChunks.length > 12) {
        warnings.push(
          `${qid}: 중난도 bogi 청크 개수(${bogiChunks.length}) 가 권장 범위(7~10) 를 벗어났습니다.`,
        );
      }
    }
  } else {
    // 기본난도: bogi 청크 합 = answer.text 정확 일치.
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

    // 5) bogi 청크 개수 권장 (7~10)
    if (bogiChunks.length < 5 || bogiChunks.length > 12) {
      warnings.push(
        `${qid}: bogi 청크 개수(${bogiChunks.length}) 가 권장 범위(7~10) 를 벗어났습니다.`,
      );
    }
  }

  // 3) "N개의 단어" 조건 ↔ word_count.total
  //    글의의미 기본은 우리말 자수 기준이라 "N개의 단어" 관례를 적용하지 않는다.
  if (!meaningBasic && Array.isArray(q.conditions) && wc?.total != null) {
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

  // 4) conditions 길이 권장 (배열형 7~8 / 글의의미 기본은 3~5 우리말 서술)
  if (Array.isArray(q.conditions)) {
    const [clo, chi] = meaningBasic ? [3, 9] : [6, 9];
    if (q.conditions.length < clo || q.conditions.length > chi) {
      warnings.push(
        `${qid}: conditions 개수(${q.conditions.length}) 가 권장 범위(${meaningBasic ? '3~5' : '7~8'}) 를 벗어났습니다.`,
      );
    }
  }
}

/**
 * ExamData 전체 정합성 검증.
 * - errors : 저장 거부 사유 (정량적 불일치)
 * - warnings : 권장 위반 (저장은 가능)
 *
 * `opts.difficulty` 를 넘기면 난이도 고유 규칙을 적용한다 (예: 최고난도는
 * bogi 가 한국어 해석문이라 슬래시 청크 검사 스킵). 비우면 일반 보기 규칙.
 */
export function validateExamData(
  data: unknown,
  opts?: { difficulty?: string; examType?: string },
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'], warnings };
  }

  const d = data as Partial<ExamData>;
  // 호출자가 명시한 difficulty/examType 이 우선, 없으면 ExamData.meta 값 사용.
  const difficulty = opts?.difficulty ?? d.meta?.difficulty;
  const examType = opts?.examType ?? d.meta?.examType;

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
      validateQuestion(q, errors, warnings, difficulty, examType);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
