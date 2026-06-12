/**
 * 변형문제 콘텐츠 정합 검증 공용 로직 (read-only).
 *
 * 기존 검증(Options 형식·중복, 빈칸 표식, 요약 구조, 순서 통합, 어법 구조·해설 모순,
 * Explanation/Options API·nan)이 다루지 않는 빈틈을 모음:
 *   · 해설이 선언한 정답 번호 ↔ CorrectAnswer 불일치 (예: 해설 "정답은 ①" vs CA ④)
 *   · 영어 전용 유형(주제·제목·함의·일치·불일치·빈칸·요약·어휘)의 한글 선택지
 *     — 주장은 한글 선택지가 실모 관행이라 제외
 *   · 함의: Paragraph 밑줄(<u>) 누락 (빈칸 표식 검증의 함의 대칭)
 *   · 삽입·삽입-고난도: 본문 ①~⑤ 위치 마커 5개 누락
 *   · 무관한문장: 본문 ①~⑤ 문장 마커 5개 누락
 *   · 어법-고난도: ①~⑤ 마커·밑줄(<u>) 5쌍 구조 깨짐 (어법은 별도 정밀 검증 존재)
 *   · Paragraph/Question 누락, Paragraph·Question 'API' 토큰 누출
 *   · source 가 textbook 으로 시작하지 않음 (주문 매칭 깨짐 — 지역명 태그 사고 유형)
 *
 * /api/admin/generated-questions/validate/content-integrity 라우트와
 * 전체 검수 CLI(scripts/audit-variant-validate-textbook.ts)에서 사용.
 */

export type ContentIntegrityIssue = {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
};

const HANGUL_RE = /[가-힣]/;
const CIRCLED_RE = /[①②③④⑤]/g;

/** 선택지가 영어여야 하는 유형 (주장은 한글 허용 관행이라 제외) */
export const ENGLISH_OPTIONS_TYPES = [
  '주제',
  '제목',
  '함의',
  '일치',
  '불일치',
  '빈칸',
  '요약',
  '어휘',
];

const MARKER_TYPES_5 = ['삽입', '삽입-고난도', '무관한문장'];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 해설 본문에서 「선언된 정답 번호」를 추출한다. 확실한 앵커 패턴만 사용:
 *   "정답은 ③" / "③번이 정답" / "③이 정답" / 해설이 "③ ..." 으로 시작
 * 없으면 null (비교 생략).
 */
export function extractDeclaredAnswer(explanation: string): string | null {
  const ex = explanation.trim();
  if (!ex) return null;
  const m1 = ex.match(/정답은\s*([①②③④⑤])/);
  if (m1) return m1[1];
  const m2 = ex.match(/([①②③④⑤])\s*(?:번)?이\s*정답/);
  if (m2) return m2[1];
  const m3 = ex.match(/^([①②③④⑤])(?=[\s번이가.,:)])/);
  if (m3) return m3[1];
  return null;
}

export function checkContentIntegrity(doc: Record<string, unknown>): ContentIntegrityIssue[] {
  const issues: ContentIntegrityIssue[] = [];
  const type = str(doc.type).trim();
  const qd = (doc.question_data ?? {}) as Record<string, unknown>;
  const paragraph = str(qd.Paragraph);
  const question = str(qd.Question);
  const options = str(qd.Options);
  const explanation = str(qd.Explanation);
  const ca = str(qd.CorrectAnswer).trim();

  // 워크북 계열은 별도 구조라 제외
  if (type.startsWith('워크북')) return issues;

  if (!paragraph.trim()) {
    issues.push({ rule: 'paragraph_missing', severity: 'error', message: 'Paragraph 가 비어 있습니다.' });
  }
  if (!question.trim()) {
    issues.push({ rule: 'question_missing', severity: 'error', message: 'Question(발문)이 비어 있습니다.' });
  }
  if (/\bAPI\b/.test(paragraph)) {
    issues.push({ rule: 'paragraph_contains_api', severity: 'warning', message: "Paragraph 에 'API' 토큰이 있습니다." });
  }
  if (/\bAPI\b/.test(question)) {
    issues.push({ rule: 'question_contains_api', severity: 'warning', message: "Question 에 'API' 토큰이 있습니다." });
  }

  // 해설 선언 정답 ↔ CorrectAnswer (단일 정답 유형만 — 복수 정답 CA 는 생략)
  if (/^[①②③④⑤]$/.test(ca)) {
    const declared = extractDeclaredAnswer(explanation);
    if (declared && declared !== ca) {
      issues.push({
        rule: 'explanation_answer_mismatch',
        severity: 'error',
        message: `해설은 정답을 ${declared} 로 선언하는데 CorrectAnswer 는 ${ca} 입니다.`,
      });
    }
  }

  // 영어 전용 유형의 한글 선택지
  if (ENGLISH_OPTIONS_TYPES.includes(type) && HANGUL_RE.test(options)) {
    issues.push({
      rule: 'hangul_options_in_english_type',
      severity: 'error',
      message: `${type} 유형 Options 에 한글이 포함되어 있습니다 (영어 선택지 규칙).`,
    });
  }

  // 함의: 밑줄 누락 — 발문이 「밑줄 친 …」 형태일 때만.
  // (함의 슬롯에 심경 변화 등 밑줄 없는 발문이 저장된 케이스는 오탐이므로 제외)
  if (
    type === '함의' &&
    paragraph.trim() &&
    question.includes('밑줄') &&
    !/<u\b/i.test(paragraph)
  ) {
    issues.push({
      rule: 'imply_paragraph_missing_underline',
      severity: 'error',
      message: '함의 유형인데 Paragraph 에 밑줄(<u>…</u>)이 없습니다.',
    });
  }

  // 삽입·삽입-고난도·무관한문장: 본문 ①~⑤ 마커 5개
  if (MARKER_TYPES_5.includes(type) && paragraph.trim()) {
    const count = (paragraph.match(CIRCLED_RE) ?? []).length;
    if (count !== 5) {
      issues.push({
        rule: 'paragraph_marker_count',
        severity: 'error',
        message: `${type} 유형 Paragraph 의 ①~⑤ 마커가 ${count}개입니다 (5개 필요).`,
      });
    }
  }

  // 어법-고난도: ①~⑤ 마커 + 밑줄 5쌍 (어법은 grammar-variant-validation 이 정밀 검증)
  if (type === '어법-고난도' && paragraph.trim()) {
    const circled = (paragraph.match(CIRCLED_RE) ?? []).length;
    const underlines = (paragraph.match(/<u\b/gi) ?? []).length;
    if (circled !== 5 || underlines !== 5) {
      issues.push({
        rule: 'grammar_advanced_structure',
        severity: 'error',
        message: `어법-고난도 Paragraph 구조 이상 — ①~⑤ ${circled}개, 밑줄 ${underlines}개 (각 5개 필요).`,
      });
    }
  }

  // source ↔ textbook 접두사 (주문·집계 매칭이 textbook 정확 일치에 의존)
  const source = str(doc.source).trim();
  const textbook = str(doc.textbook).trim();
  if (source && textbook && !source.startsWith(textbook)) {
    issues.push({
      rule: 'source_textbook_prefix_mismatch',
      severity: 'error',
      message: `source("${source.slice(0, 40)}…")가 textbook("${textbook}")으로 시작하지 않습니다 — 주문 매칭이 깨질 수 있습니다.`,
    });
  }

  return issues;
}

/**
 * 교재×유형 단위 정답 분포 편중 집계 (cross-question · read-only).
 * 단일 동그라미 정답만 집계, 표본 minCount 미만은 생략.
 */
export function summarizeAnswerDistribution(
  docs: Record<string, unknown>[],
  opts?: { threshold?: number; minCount?: number },
): {
  type: string;
  total: number;
  distribution: Record<string, number>;
  skewedAnswer: string | null;
  skewedPct: number;
}[] {
  const threshold = opts?.threshold ?? 0.6;
  const minCount = opts?.minCount ?? 10;
  const byType = new Map<string, Record<string, number>>();
  for (const d of docs) {
    const type = str(d.type).trim();
    const ca = str(((d.question_data ?? {}) as Record<string, unknown>).CorrectAnswer).trim();
    if (!type || !/^[①②③④⑤]$/.test(ca)) continue;
    const dist = byType.get(type) ?? {};
    dist[ca] = (dist[ca] ?? 0) + 1;
    byType.set(type, dist);
  }
  const rows: ReturnType<typeof summarizeAnswerDistribution> = [];
  for (const [type, distribution] of byType) {
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    if (total < minCount) continue;
    let skewedAnswer: string | null = null;
    let skewedPct = 0;
    for (const [answer, count] of Object.entries(distribution)) {
      const pct = count / total;
      if (pct >= threshold && pct > skewedPct) {
        skewedAnswer = answer;
        skewedPct = pct;
      }
    }
    rows.push({
      type,
      total,
      distribution,
      skewedAnswer,
      skewedPct: Math.round(skewedPct * 1000) / 10,
    });
  }
  return rows.sort((a, b) => b.skewedPct - a.skewedPct);
}
