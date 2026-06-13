/**
 * 변형문제 검수 시 실행되는 검증 카탈로그 (사용자 문서용 · 순수 데이터).
 * client·server 양쪽에서 모두 import 할 수 있어야 해서 mongodb 의존 없는 별도 파일에 둠.
 */
export type ValidationCatalogEntry = {
  scope: 'per-question' | 'cross-question';
  rule: string;
  title: string;
  appliesTo: string;
  description: string;
};

export const VALIDATION_CATALOG: ValidationCatalogEntry[] = [
  {
    scope: 'per-question',
    rule: 'explanation_missing|explanation_empty|explanation_nan|explanation_contains_nan|explanation_type',
    title: 'Explanation 누락 · NaN',
    appliesTo: '전 유형',
    description:
      "해설(Explanation)이 없거나, 빈 문자열, 공백, 숫자 NaN, 'nan' 토큰 포함 여부 검사. error 시 정답이라도 검수불일치로 보냄.",
  },
  {
    scope: 'per-question',
    rule: 'explanation_contains_api',
    title: "Explanation 'API' 포함",
    appliesTo: '전 유형',
    description:
      "해설에 'API' 토큰이 들어 있는지 — Anthropic 응답 누출·플레이스홀더 잔여 의심. warning.",
  },
  {
    scope: 'per-question',
    rule: 'options_contains_api',
    title: "Options 'API' 포함",
    appliesTo: '전 유형',
    description: "보기에 'API' 토큰 누출 여부. warning.",
  },
  {
    scope: 'per-question',
    rule: 'duplicate_choices_within_question',
    title: '한 문항 내 보기 중복',
    appliesTo: '전 유형',
    description:
      'Options 5개 중 텍스트가 trim 정규화 후 동일한 게 있으면 error. (cross-question 동일 Options 그룹 중복은 별도)',
  },
  {
    scope: 'per-question',
    rule: 'correct_answer_missing|correct_answer_format',
    title: 'CorrectAnswer ①~⑤ 형식',
    appliesTo: '전 유형',
    description:
      'CorrectAnswer 가 비어 있으면 error, 동그라미 번호(①②③④⑤) 형식이 아니면 warning. 복수 정답은 동그라미 연속 허용.',
  },
  {
    scope: 'per-question',
    rule: 'grammar_explanation_all_correct_strong|_weak',
    title: '어법 해설 모순 (모든 보기가 옳다고 단언)',
    appliesTo: 'type=어법',
    description:
      "해설이 「모든 밑줄/보기 맞다」 「정답이 없다」 「①~⑤ 모두 옳다」 「오류 없다」 등으로 5개 보기 전부를 정답 처리한 케이스. 강한 시그널은 error → 정답이라도 검수불일치. 약한 시그널(「나머지·그 외 …는 모두」 류 잔여 한정어가 없는 「모두 옳다」) 은 warning. lib/grammar-explanation-all-correct.ts 규칙 사용.",
  },
  {
    scope: 'per-question',
    rule: 'grammar_variant_blocks|marker_reading_order|wrong_slot_equals_original|options_separator|paragraph_empty 등',
    title: '어법 변형 구조 검증',
    appliesTo: 'type=어법',
    description:
      'Paragraph 안의 ①~⑤ 「<u>표현</u>」 5곳 형식, 동그라미 등장 순서, Options ↔ 밑줄 일치, 원문 대비 정답 칸이 표기 변형되었는지(틀린 표기로 바뀌었는지) 등. lib/grammar-variant-validation.ts 의 validateGrammarVariantQuestion 재사용. error 코드는 검수불일치로 보냄.',
  },
  {
    scope: 'per-question',
    rule: 'blank_paragraph_missing_blank',
    title: '빈칸 Paragraph 표식 검증',
    appliesTo: 'type=빈칸',
    description:
      "빈칸 유형인데 Paragraph 에 빈칸 표식(`____` 3자 이상 underscore 또는 <u>…</u>)이 없는 경우 error.",
  },
  {
    scope: 'cross-question',
    rule: 'options_overlap',
    title: 'Options 상호 일치도 (그룹 분석)',
    appliesTo: '같은 교재 · 강 · category 묶음',
    description:
      '같은 그룹 안에서 다른 문항과 보기가 얼마나 겹치는지 0~100% 척도. /admin 검증 모달의 「Options 중복 검증」.',
  },
  {
    scope: 'cross-question',
    rule: 'duplicate_options_groups',
    title: 'Options 완전 동일 묶음',
    appliesTo: '유형 내',
    description:
      'Options 문자열 trim 후 동일한 다수 문항 그룹화. /admin 검증 모달의 「선택지 데이터 검증」.',
  },
  {
    scope: 'cross-question',
    rule: 'order_options|order_correct|order_answer_verify|order_abc_distribution',
    title: '순서 통합 검증',
    appliesTo: 'type=순서',
    description:
      'Options 5세트(① (A)-(C)-(B) ~ ⑤ (C)-(B)-(A)) 고정 검사 · CorrectAnswer 정합 · 원문과 (A)(B)(C) 매핑 정답 검증 · ABC 정답 분포 편중. /admin 「순서 통합 검증」.',
  },
  {
    scope: 'cross-question',
    rule: 'summary_paragraph_structure',
    title: '요약 Paragraph 구조',
    appliesTo: 'type=요약',
    description:
      '요약문 Paragraph 의 (A)·(B) 빈칸 배치 등 구조 검증. /admin 「요약 검증」.',
  },
  {
    scope: 'cross-question',
    rule: 'question_counts',
    title: '문제수 부족 검증',
    appliesTo: 'passage 단위',
    description:
      'passages × type 조합별 변형문 수가 기준치를 채웠는지. 미충족 passage 행과 무관문 passage 행 목록.',
  },
  {
    scope: 'cross-question',
    rule: 'options_format (missing|stored_as_array|no_circled_prefix|partial_circled_prefix|bad_segment_count)',
    title: 'Options 저장 형식',
    appliesTo: '전 유형 (워크북 계열 제외)',
    description:
      'Options 데이터 없음 · 배열(string[]) 저장(회원 내보내기에서 선택지가 통째로 누락됨) · ①~⑤ 접두사 없는 보기 · 보기 수 ≠5. 표준은 「① … ### ② …」 문자열. /admin 「Options 형식 검증」 · CLI cc:audit.',
  },
  {
    scope: 'cross-question',
    rule: 'content_integrity (explanation_answer_mismatch|hangul_options_in_english_type|imply_paragraph_missing_underline|paragraph_marker_count|grammar_advanced_structure|paragraph_missing|source_textbook_prefix_mismatch 등)',
    title: '콘텐츠 정합 검증',
    appliesTo: '전 유형 (워크북 계열 제외)',
    description:
      '해설이 선언한 정답 번호 ↔ CorrectAnswer 불일치 · 영어 전용 유형(주제·제목·함의·일치·불일치·빈칸·요약·어휘)의 한글 선택지 — option_type=English 인데 한글인 경우만(option_type=Korean 은 의도적 한글 버전이라 정상, 주장도 한글 허용) · 함의 밑줄 누락 · 삽입/무관한문장 ①~⑤ 마커 수 · 어법-고난도 구조 · Paragraph/Question 누락·API 누출 · source↔textbook 접두사(모의고사·수능·평가원 계열만 — 부교재는 강·번호 source 가 정상이라 제외) · 교재×유형 정답 분포 편중(60%). /admin 「정합 검증」 · CLI cc:audit.',
  },
];
