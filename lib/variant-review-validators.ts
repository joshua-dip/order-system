/**
 * 변형문제 검수 시 한 문항에 대해 실행하는 검증 모음.
 * /admin/generated-questions 상단의 「검증」 버튼들과 동일한 규칙을
 * 단일 문항 단위로 적용해 검수 로그에 같이 남기기 위함.
 *
 * cross-question 검증(중복 보기 그룹·옵션 상호 일치도·ABC 분포 등)은
 * 한 문항만으로 판단할 수 없으므로 여기서는 건너뜀.
 */
import { Db, ObjectId } from 'mongodb';
import { detectAllCorrectClaim } from '@/lib/grammar-explanation-all-correct';
import { validateGrammarVariantQuestion } from '@/lib/grammar-variant-validation';
import {
  getPassageTextForVariantCompare,
  passageIdToValidHex,
} from '@/lib/passage-variant-text';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { CEFR_ADVANCED_VARIANT_TYPES } from '@/lib/variant-pricing';

export type ReviewValidationIssue = {
  /** 검증 규칙 식별자 — UI/로그 필터용 */
  rule: string;
  /** error: status를 검수불일치로 강제, warning: 로그에만 남김 */
  severity: 'error' | 'warning';
  message: string;
};

type QuestionDataView = {
  paragraph: string;
  options: string;
  explanation: string;
  question: string;
  correctAnswer: string;
};

function getQDView(qd: Record<string, unknown>): QuestionDataView {
  return {
    paragraph: typeof qd.Paragraph === 'string' ? qd.Paragraph : '',
    options: typeof qd.Options === 'string' ? qd.Options : '',
    explanation: typeof qd.Explanation === 'string' ? qd.Explanation : '',
    question: typeof qd.Question === 'string' ? qd.Question : '',
    correctAnswer:
      typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer : '',
  };
}

/** Explanation 'API' 검증 — Explanation 에 'API' 토큰 포함 */
function checkExplanationApi(v: QuestionDataView): ReviewValidationIssue[] {
  if (!v.explanation) return [];
  return /\bAPI\b/.test(v.explanation)
    ? [
        {
          rule: 'explanation_contains_api',
          severity: 'warning',
          message: "Explanation 본문에 'API' 토큰이 포함되어 있습니다.",
        },
      ]
    : [];
}

/** Explanation 'nan'/누락 검증 */
function checkExplanationNanOrMissing(
  qd: Record<string, unknown>,
): ReviewValidationIssue[] {
  const raw = qd.Explanation;
  if (raw == null) {
    return [
      {
        rule: 'explanation_missing',
        severity: 'error',
        message: 'Explanation 필드가 없습니다.',
      },
    ];
  }
  if (typeof raw === 'number' && Number.isNaN(raw)) {
    return [
      {
        rule: 'explanation_nan',
        severity: 'error',
        message: 'Explanation 이 숫자 NaN 으로 저장되어 있습니다.',
      },
    ];
  }
  if (typeof raw !== 'string') {
    return [
      {
        rule: 'explanation_type',
        severity: 'error',
        message: `Explanation 이 문자열이 아닙니다. (${typeof raw})`,
      },
    ];
  }
  if (!raw.trim()) {
    return [
      {
        rule: 'explanation_empty',
        severity: 'error',
        message: 'Explanation 이 비어 있거나 공백만 있습니다.',
      },
    ];
  }
  if (/\bnan\b/i.test(raw)) {
    const cleaned = raw.replace(/\bNan\s+[A-Z][a-z]+/g, '');
    if (/\bnan\b/i.test(cleaned)) {
      return [
        {
          rule: 'explanation_contains_nan',
          severity: 'error',
          message: "Explanation 본문에 'nan' 토큰이 포함되어 있습니다.",
        },
      ];
    }
  }
  return [];
}

/** Options 'API' 검증 */
function checkOptionsApi(v: QuestionDataView): ReviewValidationIssue[] {
  if (!v.options) return [];
  return /\bAPI\b/.test(v.options)
    ? [
        {
          rule: 'options_contains_api',
          severity: 'warning',
          message: "Options 본문에 'API' 토큰이 포함되어 있습니다.",
        },
      ]
    : [];
}

/** 같은 문항 내 보기 중복 — Options 5개가 trim 후 동일한 게 있는지 */
function checkDuplicateChoicesWithinQuestion(
  v: QuestionDataView,
): ReviewValidationIssue[] {
  if (!v.options) return [];
  const segs = splitQuestionOptionSegments(v.options)
    .map((p) =>
      p
        .replace(/^[①②③④⑤]\s*/, '')
        .replace(/^\d+[\).:．]\s*/u, '')
        .trim(),
    )
    .filter(Boolean);
  if (segs.length < 2) return [];
  const seen = new Map<string, number>();
  const dupSamples: string[] = [];
  for (const s of segs) {
    const k = s.replace(/\s+/g, ' ');
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, c] of seen) {
    if (c > 1) dupSamples.push(`"${k.slice(0, 40)}${k.length > 40 ? '…' : ''}" ×${c}`);
  }
  if (dupSamples.length === 0) return [];
  return [
    {
      rule: 'duplicate_choices_within_question',
      severity: 'error',
      message: `한 문항 내 보기 중 텍스트가 동일한 보기가 있습니다: ${dupSamples.join(', ')}`,
    },
  ];
}

/** 어법 해설 모순 검증 — 해설이 모든 보기가 옳다고 단언 */
function checkGrammarAllCorrectClaim(
  type: string,
  v: QuestionDataView,
): ReviewValidationIssue[] {
  if (type !== '어법' || !v.explanation) return [];
  const hits = detectAllCorrectClaim(v.explanation);
  if (hits.length === 0) return [];
  const strong = hits.some((h) => h.strong);
  return [
    {
      rule: strong
        ? 'grammar_explanation_all_correct_strong'
        : 'grammar_explanation_all_correct_weak',
      severity: strong ? 'error' : 'warning',
      message: `어법 해설이 "${hits.map((h) => h.label).join(', ')}" 패턴을 포함합니다. 정답 없는 문항으로 판정되거나 해설/정답 불일치 가능성이 높습니다.`,
    },
  ];
}

/** 어법 변형 구조 검증 — 기존 grammar-variant 검증 재사용 */
async function checkGrammarVariantStructure(
  db: Db,
  type: string,
  qd: Record<string, unknown>,
  passageId: unknown,
): Promise<ReviewValidationIssue[]> {
  if (type !== '어법') return [];
  let original: string | null = null;
  const hex = passageIdToValidHex(passageId);
  if (hex) {
    try {
      const passage = await db
        .collection('passages')
        .findOne({ _id: new ObjectId(hex) }, { projection: { content: 1 } });
      if (passage) {
        original =
          getPassageTextForVariantCompare(
            (passage as { content?: unknown }).content,
          ).trim() || null;
      }
    } catch {
      /* ignore */
    }
  }
  const { errors, warnings } = validateGrammarVariantQuestion(qd, original);
  const out: ReviewValidationIssue[] = [];
  for (const e of errors) {
    out.push({
      rule: `grammar_variant_${e.code}`,
      severity: 'error',
      message: e.message,
    });
  }
  for (const w of warnings) {
    out.push({
      rule: `grammar_variant_${w.code}`,
      severity: 'warning',
      message: w.message,
    });
  }
  return out;
}

/** 빈칸 Paragraph 검증 — type=빈칸인데 본문에 빈칸 표식이 없음 */
function checkBlankParagraphMissingUnderline(
  type: string,
  v: QuestionDataView,
): ReviewValidationIssue[] {
  if (type !== '빈칸' && type !== '빈칸-고난도') return [];
  if (!v.paragraph.trim()) return [];
  // 빈칸 표식: 일반적으로 ____ (3자 이상 연속 underscore), 또는 <u>…</u>가 들어가는 케이스
  const hasUnderscoreBlank = /_{3,}/.test(v.paragraph);
  const hasUTagBlank = /<u\b[^>]*>\s*[_\s]*<\/u>/i.test(v.paragraph);
  if (hasUnderscoreBlank || hasUTagBlank) return [];
  return [
    {
      rule: 'blank_paragraph_missing_blank',
      severity: 'error',
      message: '빈칸 유형인데 Paragraph에 빈칸 표식 (____ 또는 <u>…</u>) 이 없습니다.',
    },
  ];
}

/** CorrectAnswer ①~⑤ 정합성 — 표기 규칙(memory에 저장된 룰) */
function checkCorrectAnswerCircled(
  v: QuestionDataView,
): ReviewValidationIssue[] {
  if (!v.correctAnswer) {
    return [
      {
        rule: 'correct_answer_missing',
        severity: 'error',
        message: 'CorrectAnswer 가 비어 있습니다.',
      },
    ];
  }
  const ca = v.correctAnswer.trim();
  // 단수: ①②③④⑤ 중 하나
  if (/^[①②③④⑤]$/.test(ca)) return [];
  // 복수 (어법-고난도 등): 동그라미만 연속
  if (/^[①②③④⑤]{2,}$/.test(ca)) return [];
  return [
    {
      rule: 'correct_answer_format',
      severity: 'warning',
      message: `CorrectAnswer 가 동그라미 번호 형식이 아닙니다. (현재: "${ca}") — 표기 규칙은 ①②③④⑤ 중 하나(또는 복수 정답이면 동그라미 연속).`,
    },
  ];
}

/**
 * 한 문항에 대한 모든 per-question 검증을 실행해 issue 배열을 돌려준다.
 */
/** CEFR 고난도(대의·일치 계열): 해설에 어휘 글로싱(유의어)이 있는지 — 경고. */
const CEFR_ADVANCED_SET = new Set<string>(CEFR_ADVANCED_VARIANT_TYPES);
function checkCefrAdvancedGloss(type: string, v: QuestionDataView): ReviewValidationIssue[] {
  if (!CEFR_ADVANCED_SET.has(type)) return [];
  const exp = v.explanation ?? '';
  if (!/유의어/.test(exp)) {
    return [
      {
        rule: 'cefr_advanced_missing_gloss',
        severity: 'warning',
        message:
          'CEFR 고난도 유형인데 해설에 어휘 풀이(유의어)가 없습니다. C2~C3 단어를 썼다면 「[고난도 어휘] 단어: 뜻 (유의어: …)」 형식으로 기재하세요.',
      },
    ];
  }
  return [];
}

export async function runPerQuestionValidations(
  db: Db,
  doc: Record<string, unknown>,
): Promise<ReviewValidationIssue[]> {
  const qdRaw = doc.question_data;
  if (!qdRaw || typeof qdRaw !== 'object' || Array.isArray(qdRaw)) {
    return [
      {
        rule: 'question_data_missing',
        severity: 'error',
        message: 'question_data 객체가 없습니다.',
      },
    ];
  }
  const qd = qdRaw as Record<string, unknown>;
  const v = getQDView(qd);
  const type = String(doc.type ?? '').trim();

  const issues: ReviewValidationIssue[] = [];

  issues.push(...checkExplanationNanOrMissing(qd));
  issues.push(...checkExplanationApi(v));
  issues.push(...checkOptionsApi(v));
  issues.push(...checkDuplicateChoicesWithinQuestion(v));
  issues.push(...checkCorrectAnswerCircled(v));
  issues.push(...checkGrammarAllCorrectClaim(type, v));
  issues.push(...checkCefrAdvancedGloss(type, v));
  issues.push(...checkBlankParagraphMissingUnderline(type, v));
  issues.push(...(await checkGrammarVariantStructure(db, type, qd, doc.passage_id)));

  return issues;
}

/**
 * 검수에서 status 전이를 결정할 때 쓰는 헬퍼.
 * `error` 시그널 1건 이상이면 정답이라도 검수불일치로 보내야 함.
 */
export function hasBlockingIssue(issues: ReviewValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export { VALIDATION_CATALOG } from '@/lib/variant-review-catalog';
export type { ValidationCatalogEntry } from '@/lib/variant-review-catalog';
