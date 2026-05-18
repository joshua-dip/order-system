/**
 * 서술형 출제기 — 저장된 essay_exams 점검·자동 수정 (Pro 전용, API 키 없음).
 *
 * 검출 (auditExam):
 *   - errors   : `validateExamData()` 가 잡는 정량 불일치 + 추가 검사
 *   - warnings : validator 경고 + 표준화 위반
 *   - fixable  : 자동 수정 가능한 항목 키 목록
 *   - htmlStale: 현재 renderer 와 저장된 html 이 다른지 (수정 가능)
 *
 * 자동 수정 (applyFixes):
 *   - word_count.total / words[] 재계산 (answer.text 토큰화)
 *   - conditions 의 "N 개의 단어" N 보정 (word_count.total 에 맞춤)
 *   - meta.info 4슬롯(학교/학년/성명/배점) 정규화
 *   - questions[i].id 를 `서·논술형-N` 형식으로 정규화
 *   - html 재빌드 (현재 renderer + applyExamMetaOverrides)
 *
 * 자동 수정 대상이 아닌 것 (감지만):
 *   - bogi / passage / answer.text 본문 → 출제 의도 변경 위험
 *   - passage_id ↔ passages 미스매치
 */

import {
  ExamData,
  Question,
  applyExamMetaOverrides,
  buildExamHtml,
  readExamCss,
} from './essay-exam-html';
import { validateExamData } from './essay-exam-validator';
import { EssayExamDoc } from './essay-exams-store';

export interface AuditFinding {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** 자동 수정 가능 키 (applyFixes 가 처리하는 항목) */
  fixable?: boolean;
}

export interface AuditResult {
  examId: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  folder: string;
  findings: AuditFinding[];
  /** 자동 수정 1번이라도 가능한지 */
  hasFixable: boolean;
  /** validator 가 통과시킨 데이터인지 */
  validatorPassed: boolean;
  /** 현재 renderer 로 다시 빌드했을 때 저장 html 과 다른지 */
  htmlStale: boolean;
}

export interface AuditOptions {
  /** passage_id 검증을 위한 passages 컬렉션 핸들 (있으면 미스매치 검사) */
  passageLookup?: (passageId: string) => Promise<{ textbook?: string; source_key?: string } | null>;
}

const STANDARD_INFO_LABELS = ['학교', '학년', '성명', '배점'];

function tokenizeWords(text: string): string[] {
  return text
    .replace(/[,.;:!?"─—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function extractConditionN(condition: string): number | null {
  const m = condition.match(/(\d+)\s*개의?\s*단어/);
  return m ? Number(m[1]) : null;
}

function normalizeQuestionId(idx: number, tag: string): string {
  return `${tag}-${idx + 1}`;
}

export async function auditExam(
  doc: EssayExamDoc & { _id: string },
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const findings: AuditFinding[] = [];
  const data = doc.data as ExamData | undefined;

  /* 0) data 가 유효한 객체가 아닌 케이스 */
  if (!data || typeof data !== 'object') {
    findings.push({ level: 'error', code: 'NO_DATA', message: 'data 객체가 없음' });
    return {
      examId: doc._id,
      textbook: doc.textbook,
      sourceKey: doc.sourceKey,
      difficulty: doc.difficulty,
      folder: doc.folder,
      findings,
      hasFixable: false,
      validatorPassed: false,
      htmlStale: false,
    };
  }

  /* 1) validator 재실행 */
  const validation = validateExamData(data, { difficulty: doc.difficulty });
  for (const e of validation.errors) {
    findings.push({ level: 'error', code: 'VALIDATOR', message: e });
  }
  for (const w of validation.warnings) {
    findings.push({ level: 'warning', code: 'VALIDATOR', message: w });
  }

  /* 2) word_count 재계산 + conditions N 일치 (수정 가능) */
  for (let qi = 0; qi < (data.questions ?? []).length; qi++) {
    const q = data.questions[qi];
    if (!q?.answer?.text) continue;
    const actualCount = tokenizeWords(q.answer.text).length;
    const wcTotal = Number(q.answer.word_count?.total ?? -1);
    if (wcTotal !== actualCount) {
      findings.push({
        level: 'error',
        code: 'WORD_COUNT_MISMATCH',
        message: `Q${q.id}: word_count.total(${wcTotal}) ≠ answer.text 토큰수(${actualCount})`,
        fixable: true,
      });
    }
    const wordsArr = q.answer.word_count?.words;
    if (Array.isArray(wordsArr) && wordsArr.length !== actualCount) {
      findings.push({
        level: 'warning',
        code: 'WORDS_LENGTH_MISMATCH',
        message: `Q${q.id}: word_count.words 길이(${wordsArr.length}) ≠ 토큰수(${actualCount})`,
        fixable: true,
      });
    }
    /* conditions 의 "N개의 단어" */
    const condN = (q.conditions ?? [])
      .map(extractConditionN)
      .find(n => n !== null);
    if (typeof condN === 'number' && condN !== actualCount) {
      findings.push({
        level: 'error',
        code: 'CONDITION_N_MISMATCH',
        message: `Q${q.id}: conditions 의 "${condN}개의 단어" ≠ 실제 토큰수(${actualCount})`,
        fixable: true,
      });
    }
  }

  /* 3) meta.info 4슬롯 (학교/학년/성명/배점) */
  const info = data.meta?.info ?? [];
  const firstFour = info.slice(0, 4).map(i => String(i.label ?? '').trim());
  const slotsOk = STANDARD_INFO_LABELS.every((label, idx) => firstFour[idx] === label);
  if (!slotsOk) {
    findings.push({
      level: 'warning',
      code: 'META_INFO_SLOTS',
      message: `meta.info 4슬롯(학교/학년/성명/배점) 형식이 아님 (현재: [${firstFour.join(', ')}])`,
      fixable: true,
    });
  }

  /* 4) questions[i].id 형식 */
  const tag = String(data.question_set?.tag ?? '서·논술형').trim();
  for (let qi = 0; qi < (data.questions ?? []).length; qi++) {
    const q = data.questions[qi];
    const expected = normalizeQuestionId(qi, tag);
    if (String(q?.id ?? '') !== expected) {
      findings.push({
        level: 'warning',
        code: 'QUESTION_ID_FORMAT',
        message: `questions[${qi}].id="${q?.id}" → 기대값 "${expected}"`,
        fixable: true,
      });
    }
  }

  /* 5) HTML stale 여부 */
  let htmlStale = false;
  try {
    const css = readExamCss();
    const finalData = applyExamMetaOverrides(data, {});
    const rebuilt = buildExamHtml(finalData, css);
    if (rebuilt !== (doc.html ?? '')) {
      htmlStale = true;
      findings.push({
        level: 'warning',
        code: 'HTML_STALE',
        message: '저장된 html 이 현재 renderer 출력과 다름 (재빌드 필요)',
        fixable: true,
      });
    }
  } catch (e) {
    findings.push({
      level: 'error',
      code: 'HTML_REBUILD_FAIL',
      message: `HTML 재빌드 실패: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  /* 6) passage_id 검증 (수정 X) */
  if (doc.passageId && opts.passageLookup) {
    try {
      const p = await opts.passageLookup(doc.passageId);
      if (!p) {
        findings.push({
          level: 'error',
          code: 'PASSAGE_NOT_FOUND',
          message: `passage_id="${doc.passageId}" 가 passages 컬렉션에 없음`,
        });
      } else {
        if (p.textbook && p.textbook !== doc.textbook) {
          findings.push({
            level: 'warning',
            code: 'TEXTBOOK_MISMATCH',
            message: `textbook 불일치: exam="${doc.textbook}" vs passage="${p.textbook}"`,
          });
        }
        if (p.source_key && p.source_key !== doc.sourceKey) {
          findings.push({
            level: 'warning',
            code: 'SOURCEKEY_MISMATCH',
            message: `sourceKey 불일치: exam="${doc.sourceKey}" vs passage="${p.source_key}"`,
          });
        }
      }
    } catch {
      /* lookup 실패는 무시 */
    }
  }

  return {
    examId: doc._id,
    textbook: doc.textbook,
    sourceKey: doc.sourceKey,
    difficulty: doc.difficulty,
    folder: doc.folder,
    findings,
    hasFixable: findings.some(f => f.fixable),
    validatorPassed: validation.valid,
    htmlStale,
  };
}

export interface FixResult {
  data: ExamData;
  html: string;
  applied: string[];
}

/**
 * 자동 수정 가능한 항목들을 적용한 새 data + html 반환.
 * 원본 doc 은 변경하지 않음. 적용 항목은 applied 배열에 누적.
 */
export function applyFixes(doc: EssayExamDoc): FixResult {
  const applied: string[] = [];
  const data: ExamData = JSON.parse(JSON.stringify(doc.data ?? {}));

  /* 1) questions 의 word_count + conditions N 보정 */
  const tag = String(data.question_set?.tag ?? '서·논술형').trim();
  for (let qi = 0; qi < (data.questions ?? []).length; qi++) {
    const q = data.questions[qi];
    if (!q) continue;

    /* id 정규화 */
    const expectedId = normalizeQuestionId(qi, tag);
    if (String(q.id ?? '') !== expectedId) {
      q.id = expectedId;
      applied.push(`Q${qi}: id="${expectedId}"`);
    }

    if (!q.answer?.text) continue;
    const tokens = tokenizeWords(q.answer.text);
    const actual = tokens.length;

    /* word_count.total */
    if (!q.answer.word_count) {
      (q.answer as Question['answer']).word_count = { total: actual, words: tokens, note: null };
      applied.push(`Q${q.id}: word_count 신규 생성 (total=${actual})`);
    } else {
      if (Number(q.answer.word_count.total) !== actual) {
        applied.push(`Q${q.id}: word_count.total ${q.answer.word_count.total}→${actual}`);
        q.answer.word_count.total = actual;
      }
      /* words[] 재계산 — 길이가 안 맞으면만 갱신 (사용자가 명시적으로 다르게 적은 케이스 보존) */
      if (!Array.isArray(q.answer.word_count.words) || q.answer.word_count.words.length !== actual) {
        q.answer.word_count.words = tokens;
        applied.push(`Q${q.id}: word_count.words 재계산 (${actual}개)`);
      }
    }

    /* conditions "N개의 단어" 보정 */
    if (Array.isArray(q.conditions)) {
      for (let ci = 0; ci < q.conditions.length; ci++) {
        const cond = q.conditions[ci];
        const m = cond.match(/(\d+)\s*개의?\s*단어/);
        if (m && Number(m[1]) !== actual) {
          q.conditions[ci] = cond.replace(m[0], `${actual} 개의 단어`);
          applied.push(`Q${q.id}: conditions[${ci}] "${m[0]}"→"${actual} 개의 단어"`);
        }
      }
    }
  }

  /* 2) meta.info 4슬롯 정규화 — applyExamMetaOverrides 가 이미 정규화 로직 가짐 */
  const beforeInfoKey = JSON.stringify(data.meta?.info ?? []);
  const normalized = applyExamMetaOverrides(data, {});
  const afterInfoKey = JSON.stringify(normalized.meta?.info ?? []);
  if (beforeInfoKey !== afterInfoKey) {
    applied.push('meta.info 4슬롯 정규화');
  }
  Object.assign(data, normalized);

  /* 3) html 재빌드 */
  const css = readExamCss();
  const html = buildExamHtml(data, css);
  if (html !== (doc.html ?? '')) {
    applied.push('html 재빌드');
  }

  return { data, html, applied };
}
