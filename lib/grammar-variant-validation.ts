/**
 * 어법 유형 변형문 — 구조·보기 일치·원문 대비 표기 변형 검증
 * (의미/논리 어법 오류 자체는 판별하지 않음)
 */

import { extractOptionBody, optionsLineForChoice } from '@/lib/question-options-segments';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const CIRCLED_NUM: Record<string, number> = {
  '①': 1,
  '②': 2,
  '③': 3,
  '④': 4,
  '⑤': 5,
};

export type GrammarVariantIssueCode =
  | 'paragraph_empty'
  | 'blocks'
  | 'marker_reading_order'
  | 'options_separator'
  | 'correct_answer'
  | 'options_mismatch'
  | 'no_surface_change'
  | 'wrong_slot_equals_original'
  | 'original_slots_parse_failed'
  | 'non_wrong_slot_differs_from_original'
  | 'no_passage';

export type GrammarVariantIssue = {
  code: GrammarVariantIssueCode;
  message: string;
};

function collapseWs(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/** 밑줄 바깥 gap: 연속 공백만 한 칸으로. (문자마다 trim 하면 'we '+①+'would' → 'we'+'would' 붙어 원문과 불일치) */
function normalizeGapSpacing(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
}

function parseChoiceNumber(answer: string): number {
  const t = answer.trim();
  if (!t) return 0;
  if (CIRCLED_NUM[t] != null) return CIRCLED_NUM[t]!;
  const first = t.charAt(0);
  if (CIRCLED_NUM[first] != null) return CIRCLED_NUM[first]!;
  const n = parseInt(t.replace(/[^\d]/g, ''), 10);
  if (n >= 1 && n <= 5) return n;
  return 0;
}

/** 어법 표준 Options: \`①###②###③###④###⑤\` (공백은 세그먼트 trim만 허용) */
export function isGrammarOptionsMarkersOnlyFormat(options: string): boolean {
  const segs = options
    .trim()
    .split('###')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (segs.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    if (segs[i] !== CIRCLED[i]) return false;
  }
  return true;
}

/** Options에 <u>…</u> 포함 시 Paragraph inner(태그 없음)와 비교 */
function optionBodyMatchesUnderlineInner(body: string | null, inner: string): boolean {
  if (body == null) return false;
  const a = collapseWs(body.replace(/<\/?u>/gi, '').trim());
  const b = collapseWs(inner);
  return a === b;
}

/** Paragraph 안의 ① <u>…</u> 블록 (순서대로) */
export function extractGrammarUnderlineBlocks(paragraph: string): Array<{
  marker: string;
  num: number;
  inner: string;
}> {
  const re = /([①②③④⑤])\s*<u>([\s\S]*?)<\/u>/gi;
  const out: Array<{ marker: string; num: number; inner: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    const num = CIRCLED_NUM[m[1]] ?? 0;
    if (!num) continue;
    out.push({ marker: m[1], num, inner: m[2].trim() });
  }
  return out;
}

export function stripGrammarParagraphToPlain(paragraph: string): string {
  return collapseWs(
    paragraph
      .replace(/<u>([\s\S]*?)<\/u>/gi, '$1')
      .replace(/[①②③④⑤]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * 밑줄 5개 앞뒤의 고정 텍스트(gap 6개) + 밑줄 inner 5개 (지문 앞→뒤 순서).
 * 원문에서 동일 gap으로 각 칸의 표현을 잘라낼 때 사용.
 */
export function parseGrammarGapsAndInners(paragraph: string): {
  gaps: string[];
  inners: string[];
} | null {
  const re = /([①②③④⑤])\s*<u>([\s\S]*?)<\/u>/gi;
  const gaps: string[] = [];
  const inners: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(paragraph)) !== null) {
    const gapRaw = paragraph.slice(last, m.index).replace(/[①②③④⑤]/g, '');
    gaps.push(normalizeGapSpacing(gapRaw));
    inners.push(collapseWs(m[2].trim()));
    last = m.index + m[0].length;
    count++;
  }
  if (count !== 5) return null;
  const tailRaw = paragraph.slice(last).replace(/[①②③④⑤]/g, '');
  gaps.push(normalizeGapSpacing(tailRaw));
  if (gaps.length !== 6) return null;
  return { gaps, inners };
}

/** 지문 앞→뒤 순서에서 wi번 밑줄 **직전까지** 평문(공백 정규화). */
function buildGrammarPlainPrefixBeforeWrongSlot(
  parsed: { gaps: string[]; inners: string[] },
  wi: number
): string {
  let s = '';
  for (let k = 0; k < wi; k++) {
    s += parsed.gaps[k] + parsed.inners[k];
  }
  s += parsed.gaps[wi];
  return collapseWs(s);
}

/** wi번 밑줄 **직후부터** 끝까지 평문(공백 정규화). */
function buildGrammarPlainSuffixAfterWrongSlot(
  parsed: { gaps: string[]; inners: string[] },
  wi: number
): string {
  let s = '';
  for (let k = wi + 1; k < 5; k++) {
    s += parsed.gaps[k] + parsed.inners[k];
  }
  s += parsed.gaps[5];
  return collapseWs(s);
}

/**
 * @param originalPassage passages 원문(original 우선) — 없으면 원문 대비 변형 검사 생략
 */
export function validateGrammarVariantQuestion(
  questionData: Record<string, unknown>,
  originalPassage: string | null
): {
  errors: GrammarVariantIssue[];
  warnings: GrammarVariantIssue[];
} {
  const errors: GrammarVariantIssue[] = [];
  const warnings: GrammarVariantIssue[] = [];
  const paragraph =
    typeof questionData.Paragraph === 'string' ? questionData.Paragraph : '';
  const options = typeof questionData.Options === 'string' ? questionData.Options : '';
  const correctRaw =
    typeof questionData.CorrectAnswer === 'string' ? questionData.CorrectAnswer : '';

  if (!paragraph.trim()) {
    errors.push({
      code: 'paragraph_empty',
      message: 'Paragraph가 비어 있습니다.',
    });
    return { errors, warnings };
  }

  if (options.trim() && !options.includes('###')) {
    warnings.push({
      code: 'options_separator',
      message:
        'Options는 ①~⑤ 보기 사이를 `###`만으로 구분한 한 줄 문자열 형식을 사용하는 것이 좋습니다. (기존 줄바꿈 형식은 호환되지만 신규 생성 시 ### 형식을 권장합니다.)',
    });
  }

  const blocks = extractGrammarUnderlineBlocks(paragraph);
  const nums = new Set(blocks.map((b) => b.num));
  const needAll = [1, 2, 3, 4, 5].every((n) => nums.has(n));

  if (blocks.length !== 5 || nums.size !== 5 || !needAll) {
    errors.push({
      code: 'blocks',
      message:
        '어법 Paragraph에 ①~⑤ 각각 한 번씩, 형식 「번호 <u>표현</u>」인 밑줄 5곳이 필요합니다.',
    });
  } else if (!blocks.every((b, i) => b.num === i + 1)) {
    const seq = blocks.map((b) => b.marker).join(' → ');
    errors.push({
      code: 'marker_reading_order',
      message: `동그라미 번호는 지문 앞에서 뒤로 읽는 순서대로 ①→②→③→④→⑤여야 합니다. (현재 나타나는 순서: ${seq})`,
    });
  }

  const orderOk =
    blocks.length === 5 &&
    nums.size === 5 &&
    needAll &&
    blocks.every((b, i) => b.num === i + 1);

  const wrongNum = parseChoiceNumber(correctRaw);
  if (wrongNum < 1 || wrongNum > 5) {
    errors.push({
      code: 'correct_answer',
      message: 'CorrectAnswer는 ①~⑤ 또는 1~5 중 어법상 틀린 번호 하나여야 합니다.',
    });
  }

  // Options: 표준은 ①###②###③###④###⑤ 만 → 보기↔밑줄 문자열 비교 생략. 구형(보기에 단어 포함)은 CorrectAnswer 번호만 비교.
  const checkAllBodies = wrongNum < 1 || wrongNum > 5;
  const markersOnlyOptions = isGrammarOptionsMarkersOnlyFormat(options);

  if (blocks.length === 5 && nums.size === 5 && needAll && !markersOnlyOptions) {
    for (let n = 1; n <= 5; n++) {
      const block = blocks.find((b) => b.num === n);
      const line = optionsLineForChoice(options, n);
      if (!line) {
        errors.push({
          code: 'options_mismatch',
          message: `Options에 ${CIRCLED[n - 1]}(또는 ${n}.) 로 시작하는 보기 줄이 없습니다.`,
        });
        continue;
      }
      if (checkAllBodies || n === wrongNum) {
        const body = extractOptionBody(line, n);
        if (body == null || !optionBodyMatchesUnderlineInner(body, block?.inner ?? '')) {
          errors.push({
            code: 'options_mismatch',
            message: checkAllBodies
              ? `번호 ${CIRCLED[n - 1]}의 보기(동그라미 뒤)와 Paragraph 밑줄 안 표현이 일치하지 않습니다. (<u> 포함 시 태그 안 문자는 동일해야 합니다)`
              : `정답 번호(CorrectAnswer) ${CIRCLED[n - 1]}의 보기와 Paragraph 해당 밑줄 안 표현이 일치하지 않습니다. (<u> 포함 시 태그 안 문자는 동일해야 합니다)`,
          });
        }
      }
    }
  }

  const orig = originalPassage?.trim() ? collapseWs(originalPassage) : '';

  if (!orig) {
    if (wrongNum >= 1 && wrongNum <= 5 && blocks.length === 5) {
      warnings.push({
        code: 'no_passage',
        message:
          '연결된 원문(passages)이 없어, 원문 대비 표기 변형 여부는 확인하지 못했습니다.',
      });
    }
  } else if (blocks.length === 5 && nums.size === 5 && needAll && wrongNum >= 1 && wrongNum <= 5) {
    const plain = stripGrammarParagraphToPlain(paragraph);
    if (plain === orig) {
      errors.push({
        code: 'no_surface_change',
        message:
          '밑줄·번호를 제거한 지문이 원문과 동일합니다. 정답 번호에 해당하는 밑줄은 원문과 다른 표기(철자·품사형 등)로 변형되어 있어야 합니다.',
      });
    }

    // CorrectAnswer 번호 칸: 원문에서 같은 앞·뒤 맥락으로 잘랐을 때 지문 밑줄과 같으면 오답(어법 틀림)이 성립하지 않음
    if (orderOk) {
      const parsed = parseGrammarGapsAndInners(paragraph);
      if (parsed) {
        const wi = wrongNum - 1;
        const pre = buildGrammarPlainPrefixBeforeWrongSlot(parsed, wi);
        const suf = buildGrammarPlainSuffixAfterWrongSlot(parsed, wi);
        if (!orig.startsWith(pre) || !orig.endsWith(suf) || orig.length < pre.length + suf.length) {
          warnings.push({
            code: 'original_slots_parse_failed',
            message:
              '원문에서 CorrectAnswer 번호에 해당하는 칸을 특정하지 못했습니다. (지문·원문 불일치, 밑줄 바깥 텍스트 편집, 또는 공백·따옴표 차이일 수 있습니다.)',
          });
        } else {
          const mid = collapseWs(orig.slice(pre.length, orig.length - suf.length));
          const innerW = collapseWs(parsed.inners[wi]);
          if (mid === innerW) {
            errors.push({
              code: 'wrong_slot_equals_original',
              message: `CorrectAnswer ${CIRCLED[wi]}번 밑줄 표현이 원문 해당 위치와 동일합니다. 어법 오답이 되려면 원문과 다른 표기(틀린 형태)여야 합니다.`,
            });
          }

          for (let k = 0; k < 5; k++) {
            if (k === wi) continue;
            const preK = buildGrammarPlainPrefixBeforeWrongSlot(parsed, k);
            const sufK = buildGrammarPlainSuffixAfterWrongSlot(parsed, k);
            if (
              orig.startsWith(preK) &&
              orig.endsWith(sufK) &&
              orig.length >= preK.length + sufK.length
            ) {
              const midK = collapseWs(orig.slice(preK.length, orig.length - sufK.length));
              if (midK !== collapseWs(parsed.inners[k])) {
                warnings.push({
                  code: 'non_wrong_slot_differs_from_original',
                  message: `번호 ${CIRCLED[k]}는 어법 오답이 아닌데, 밑줄 표현이 원문 해당 위치와 다릅니다. (원문과 동일한 올바른 표기여야 합니다.)`,
                });
              }
            }
          }
        }
      }
    }
  }

  return { errors, warnings };
}
